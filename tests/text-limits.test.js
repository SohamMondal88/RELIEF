// Issue #120: typed, stored and imported text has size limits and is shown as inert text.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../assets/js/reminders.js');
const { evaluateSymptomSafety, detectEmergencySigns } = require('../assets/js/symptoms.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const MARKUP = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
const SCRIPTS = ['বাংলা ভাষায় লেখা', 'हिन्दी में लिखा हुआ', 'தமிழ் உரை', 'مرحبا بالعالم', '日本語のテキスト', 'é ZWJ 👨‍👩‍👧 😀'];

// ---- reminders: stored data is re-limited when it is read back ----

test('escapeHtml turns markup into inert text', () => {
  const out = R.escapeHtml(MARKUP);
  assert.ok(!/[<>]/.test(out));
  assert.ok(!out.includes('"') && !out.includes("'"));
  assert.strictEqual(R.escapeHtml(null), '');
  assert.strictEqual(R.escapeHtml(undefined), '');
  assert.strictEqual(R.escapeHtml(12), '12');
});

test('multilingual text passes through reminders unchanged', () => {
  for (const text of SCRIPTS) {
    const r = R.normalizeReminder({ id: 'x', medicine: text, instructions: text, time: '08:00' }, 0);
    assert.strictEqual(r.medicine, text);
    assert.strictEqual(r.instructions, text);
    assert.strictEqual(R.escapeHtml(text), text);
  }
});

test('oversized stored reminders are cut to the form limits', () => {
  const r = R.normalizeReminder({
    id: 'i'.repeat(1000), medicine: 'M'.repeat(100000), instructions: MARKUP.repeat(5000),
    time: '08:00', timeZone: 'Z'.repeat(10000)
  }, 0);
  assert.strictEqual(r.medicine.length, R.MAX_NAME_LENGTH);
  assert.ok(r.instructions.length <= R.MAX_INSTRUCTIONS_LENGTH);
  assert.strictEqual(r.id.length, 64);
  assert.strictEqual(r.timeZone.length, 64);
});

test('clip never leaves half an emoji and never throws on odd input', () => {
  const smile = '😀';
  const cut = R.clip('a'.repeat(79) + smile + 'b', 80);
  assert.strictEqual(cut, 'a'.repeat(79));
  assert.strictEqual(R.clip('abc', 80), 'abc');
  assert.strictEqual(R.clip(null, 5), '');
  assert.strictEqual(R.clip(undefined, 5), '');
  assert.strictEqual(R.clip({}, 100), '[object Object]');
  assert.doesNotThrow(() => R.clip('x'.repeat(5e6), 10));
});

test('a reminder with 1 MB of text loads fast and stays small', () => {
  const storage = { getItem: () => JSON.stringify([{ id: 'a', medicine: 'x'.repeat(1e6), instructions: 'y'.repeat(1e6), time: '07:30' }]) };
  const start = Date.now();
  const list = R.loadReminders(storage);
  assert.ok(Date.now() - start < 1000);
  assert.strictEqual(list.length, 1);
  assert.ok(list[0].medicine.length + list[0].instructions.length <= 380);
});

test('loadHistory falls back for missing data and survives broken data', () => {
  const sample = [{ date: '2026-01-02', event: 'a', status: 'b' }];
  const store = (value) => ({ getItem: () => value });
  assert.deepStrictEqual(R.loadHistory(store(null), 'k', sample), sample);
  assert.notStrictEqual(R.loadHistory(store(null), 'k', sample), sample);
  for (const broken of ['{not json', '"text"', '42', '{"a":1}', 'true', '']) {
    assert.deepStrictEqual(R.loadHistory(store(broken), 'k', sample), [], broken);
  }
  assert.deepStrictEqual(R.loadHistory({ getItem() { throw new Error('blocked'); } }, 'k', sample), []);
});

test('loadHistory drops junk rows, limits row count and text length, and keeps Unicode', () => {
  const rows = [null, 5, 'x', [], { date: '2026-02-03', event: 'বাংলা', status: MARKUP }];
  for (let i = 0; i < 500; i++) rows.push({ date: '2026-01-01', event: 'e'.repeat(5000), status: 's' });
  const out = R.loadHistory({ getItem: () => JSON.stringify(rows) }, 'k', []);
  assert.ok(out.length <= 200);
  assert.strictEqual(out[0].event, 'বাংলা');
  assert.strictEqual(out[0].status, MARKUP);
  assert.ok(out.every((h) => h.event.length <= 200 && h.status.length <= 200 && h.date.length <= 10));
  assert.ok(out.every((h) => typeof h.date === 'string'));
});

// ---- contact form (contact.js run against a tiny fake page) ----

function contactPage(values) {
  const make = (value) => ({ value, style: {}, nextElementSibling: { textContent: '', nextElementSibling: { textContent: '' } }, addEventListener() {}, checked: true });
  const fields = { name: make(values.name), email: make(values.email), message: make(values.message), consent: make('') };
  const context = {
    document: { getElementById: (id) => fields[id] || null, querySelectorAll: () => [], addEventListener() {} },
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(read('assets/js/contact.js'), context);
  return { fields, run: (code) => vm.runInContext(code, context) };
}

test('contact form refuses oversized name, email and message with a message, and keeps the text', () => {
  const page = contactPage({ name: 'N'.repeat(101), email: 'a'.repeat(250) + '@b.co', message: 'm'.repeat(2001) });
  assert.strictEqual(page.run('validateName()'), false);
  assert.match(page.fields.name.nextElementSibling.textContent, /100 characters or fewer/);
  assert.strictEqual(page.run('validateEmail()'), false);
  assert.match(page.fields.email.nextElementSibling.textContent, /254 characters or fewer/);
  assert.strictEqual(page.run('validateMessage()'), false);
  assert.match(page.fields.message.nextElementSibling.textContent, /2000 characters or fewer/);
  assert.strictEqual(page.fields.message.value.length, 2001);
});

test('contact form accepts text at the limit, markup and non-Latin scripts', () => {
  const edge = contactPage({ name: 'N'.repeat(100), email: 'a'.repeat(240) + '@b.co', message: 'm'.repeat(2000) });
  assert.strictEqual(edge.run('validateName()'), true);
  assert.strictEqual(edge.run('validateEmail()'), true);
  assert.strictEqual(edge.run('validateMessage()'), true);
  const text = contactPage({ name: 'অভিষেক শর্মা', email: 'a@b.co', message: SCRIPTS.join(' ') + ' ' + MARKUP });
  assert.strictEqual(text.run('validateName()'), true);
  assert.strictEqual(text.run('validateMessage()'), true);
});

test('contact.html and symptoms.html inputs carry matching maxlength attributes', () => {
  const contact = read('pages/contact.html');
  const limits = contactPage({ name: '', email: '', message: '' }).run('CONTACT_LIMITS');
  assert.match(contact, new RegExp('id="name"[^>]*maxlength="' + limits.name + '"'));
  assert.match(contact, new RegExp('id="email"[^>]*maxlength="' + limits.email + '"'));
  assert.match(contact, new RegExp('id="message"[^>]*maxlength="' + limits.message + '"'));
  const symptoms = read('pages/symptoms.html');
  for (const id of ['symptoms', 'additional-info', 'medications']) {
    assert.match(symptoms, new RegExp('id="' + id + '"[^>]*maxlength="\\d+"'), id);
  }
});

test('every search box on the public pages has a length limit', () => {
  for (const page of ['index.html', 'pages/hospitals.html', 'pages/doctors.html', 'pages/pharmacies.html', 'pages/firstaid.html', 'pages/blog.html']) {
    const inputs = read(page).match(/<input[^>]*(type="search"|placeholder="Search)[^>]*>/g) || [];
    assert.ok(inputs.length > 0, page);
    for (const tag of inputs) assert.match(tag, /maxlength="\d+"/, page + ': ' + tag);
  }
});

// ---- symptom checker: huge or hostile text is never echoed and an emergency is never cut off ----

test('1 MB of markup plus an emergency phrase at the very end is still flagged, quickly', () => {
  const text = (MARKUP + ' ').repeat(20000) + ' I have chest pain and cannot breathe';
  assert.ok(text.length > 1e6);
  const start = Date.now();
  const out = evaluateSymptomSafety({ symptomsText: text, additionalInfo: MARKUP.repeat(1000), medications: MARKUP });
  assert.ok(Date.now() - start < 3000);
  assert.strictEqual(out.isEmergency, true);
});

test('symptom results never contain the text the user typed', () => {
  const out = evaluateSymptomSafety({ symptomsText: 'mild headache ' + MARKUP, additionalInfo: MARKUP, medications: MARKUP, duration: '1-3-days', severity: 'mild' });
  const json = JSON.stringify(out);
  assert.ok(!json.includes('onerror'));
  assert.ok(!json.includes('<script'));
});

test('symptom text in other scripts and odd values does not throw', () => {
  for (const text of SCRIPTS.concat(['', '   ', null, undefined, 12345, {}, []])) {
    assert.doesNotThrow(() => evaluateSymptomSafety({ symptomsText: text }));
    assert.doesNotThrow(() => detectEmergencySigns({ symptomsText: text }));
  }
});
