/**
 * The contact form must not claim a message was sent unless the backend confirmed it (issue #74).
 *
 * node --test tests/contact-send.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../assets/js/contact-send.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const fields = { name: ' Asha Rao ', email: 'asha@example.com', subject: 'volunteer', message: ' I can help on weekends. ', consent: true };

function backendError(code, extra) {
  return Object.assign(new Error(code), { name: 'ReliefBackendError', code }, extra || {});
}

// ---------- the payload ----------

test('buildPayload trims, limits length and sends only the five known fields', () => {
  const payload = C.buildPayload(Object.assign({}, fields, { website: 'http://spam.example', extra: 'x', message: 'a'.repeat(5000) }));
  assert.deepStrictEqual(Object.keys(payload).sort(), ['consent', 'email', 'message', 'name', 'subject']);
  assert.strictEqual(payload.name, 'Asha Rao');
  assert.strictEqual(payload.message.length, C.LIMITS.message);
});

test('buildPayload only treats a real true as consent', () => {
  assert.strictEqual(C.buildPayload({ consent: true }).consent, true);
  assert.strictEqual(C.buildPayload({ consent: 'on' }).consent, false);
  assert.strictEqual(C.buildPayload({}).consent, false);
  assert.strictEqual(C.buildPayload().name, '');
});

// ---------- send(): success only on a clear confirmation ----------

test('send resolves only when the backend answers status "received", and passes the payload on', async () => {
  let sent = null;
  const api = { submitContactMessage: async (payload) => { sent = payload; return { status: 'received' }; } };
  assert.deepStrictEqual(await C.send(api, fields), { status: 'received' });
  assert.strictEqual(sent.name, 'Asha Rao');
  assert.strictEqual(sent.consent, true);
});

test('with no ReliefAPI at all the message is reported as not sent', async () => {
  await assert.rejects(() => C.send(undefined, fields), (e) => e.kind === 'unavailable' && /not sent/i.test(e.message));
  await assert.rejects(() => C.send({}, fields), (e) => e.kind === 'unavailable');
});

test('with no backend configured (what api.js does by default) the message is reported as not sent', async () => {
  const api = { submitContactMessage: async () => { throw backendError('backend-unavailable'); } };
  await assert.rejects(() => C.send(api, fields), (e) => e.kind === 'unavailable' && /not sent/i.test(e.message) && !/received|thank/i.test(e.message));
});

test('a 2xx answer that is not a clear confirmation is not a success', async () => {
  for (const answer of [{}, { ok: true }, { received: true }, { status: 'queued' }, { status: 'RECEIVED' }, null, 'received', true, []]) {
    const api = { submitContactMessage: async () => answer };
    await assert.rejects(() => C.send(api, fields), (e) => e.kind === 'not-confirmed', JSON.stringify(answer));
  }
});

test('rate limit, rejection and unknown errors each get an honest message', async () => {
  const run = (error) => C.send({ submitContactMessage: async () => { throw error; } }, fields).catch((e) => e);
  assert.strictEqual((await run(backendError('rate-limited'))).kind, 'rate-limited');
  assert.strictEqual((await run(backendError('rejected', { status: 422 }))).kind, 'rejected');
  assert.strictEqual((await run(backendError('unauthenticated'))).kind, 'unavailable');
  assert.strictEqual((await run(new TypeError('boom'))).kind, 'unavailable');
  // The visitor-facing text never leaks the raw error.
  assert.ok(!/boom/.test((await run(new TypeError('boom'))).message));
});

test('no failure message promises a reply or says the message was received', () => {
  Object.values(C.MESSAGES).forEach((text) => {
    assert.ok(!/we('|’)ve received|will respond|24 hours|thank you/i.test(text), text);
  });
});

// ---------- the email fallback ----------

test('mailtoHref fills subject and body from the form and encodes them', () => {
  const href = C.mailtoHref('info@reliefconnect.org', fields);
  assert.ok(href.startsWith('mailto:info@reliefconnect.org?subject='));
  const query = new URLSearchParams(href.split('?')[1]);
  assert.strictEqual(query.get('subject'), 'RELIEF contact: volunteer');
  assert.strictEqual(query.get('body'), 'I can help on weekends.\n\nAsha Rao');
});

test('mailtoHref keeps the link short and survives characters that break URLs', () => {
  const href = C.mailtoHref('info@reliefconnect.org', { name: 'A&B', message: 'x'.repeat(4000) + '&bcc=evil@example.com\r\nBcc: evil@example.com' });
  assert.ok(href.length < 2500);
  assert.ok(!/bcc=evil/i.test(decodeURIComponent(href.split('?')[1]).split('\n')[0].slice(0, 20)));
  const query = new URLSearchParams(href.split('?')[1]);
  assert.deepStrictEqual([...query.keys()], ['subject', 'body']);
});

// ---------- the page and the source ----------

test('the contact script no longer fakes a submission or promises a reply', () => {
  const source = read('assets', 'js', 'contact.js');
  assert.ok(!/simulateFormSubmission/.test(source), 'no simulated submission');
  assert.ok(!/received your inquiry|will respond within/i.test(source), 'no false promise');
  assert.match(source, /ReliefContactSend\.send\(/);
});

test('contact.html loads api.js and contact-send.js before contact.js', () => {
  const html = read('pages', 'contact.html');
  const at = (name) => html.indexOf('assets/js/' + name);
  assert.ok(at('form-guard.js') !== -1 && at('api.js') !== -1 && at('contact-send.js') !== -1 && at('contact.js') !== -1);
  assert.ok(at('api.js') < at('contact.js'));
  assert.ok(at('contact-send.js') < at('contact.js'));
  assert.ok(at('form-guard.js') < at('contact.js'));
});

test('ReliefAPI.submitContactMessage posts to /v1/contact-messages and fails when no backend is configured', async () => {
  const source = read('assets', 'js', 'api.js');
  const requests = [];
  const sandbox = {
    // api.js on main refers to deleteAccount without defining it (fixed separately). Define it here so this
    // test only depends on the contact call.
    deleteAccount: undefined,
    window: {},
    document: { querySelector: () => null },
    console: { error() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 201, headers: { get: () => 'application/json' }, json: async () => ({ status: 'received' }) };
    }
  };
  vm.createContext(sandbox);
  const api = new vm.Script(source + '\n;ReliefAPI;').runInContext(sandbox);
  assert.strictEqual(typeof api.submitContactMessage, 'function');

  await assert.rejects(() => api.submitContactMessage({ name: 'A' }), (e) => e.code === 'backend-unavailable');
  assert.strictEqual(requests.length, 0, 'nothing is sent without a configured backend');

  sandbox.window.RELIEF_BACKEND_URL = 'https://backend.example.test';
  const answer = await api.submitContactMessage({ name: 'A', message: 'hello there friend' });
  assert.deepStrictEqual(answer, { status: 'received' });
  assert.strictEqual(requests[0].url, 'https://backend.example.test/v1/contact-messages');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(JSON.parse(requests[0].options.body).name, 'A');
});

test('the contact page does not promise a reply time', () => {
  assert.ok(!/respond within|24 hours/i.test(read('pages', 'contact.html').replace(/Open 24 hours/g, '')), 'no promised response time');
});
