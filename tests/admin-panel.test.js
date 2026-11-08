/**
 * Tests for Issue #78: administrative controls and role checks.
 *
 * The browser cannot prove who someone is, so these tests check three things:
 *   1. the admin page says it is a demo and has no live privileged button of its own,
 *   2. the only approve/reject path asks a server (or is a labelled, browser-only demo),
 *      and what the page decides never comes from storage a visitor can edit,
 *   3. no secret and no role check lives in browser code.
 * What a real server must enforce is written down in docs/ADMIN_ACCESS.md.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../assets/js/facility-corrections.js');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function listFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(rel, exts));
    else if (exts.includes(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

const html = read('pages/admin-panel.html');
// Everything outside the moderation section is static sample markup.
const moderationStart = html.indexOf('id="correction-moderation"');
const moderationEnd = html.indexOf('</section>', moderationStart);
const staticHtml = html.slice(0, moderationStart) + html.slice(moderationEnd);

describe('admin panel page', () => {
  it('says it is a demo with no role check, before any control', () => {
    assert.match(html, /id="admin-demo-banner"[^>]*role="note"/);
    assert.ok(html.indexOf('admin-demo-banner') < html.indexOf('Triage Queue'));
    assert.match(html, /Demo interface, not a real admin console/);
    assert.match(html, /no sign-in or role check/i);
    assert.match(html, /not verified healthcare information/);
  });

  it('every button outside the moderation section is switched off', () => {
    const buttons = staticHtml.match(/<button\b[^>]*>/g) || [];
    assert.ok(buttons.length >= 2, 'the sample triage buttons are still shown');
    buttons.forEach((tag) => assert.match(tag, /\bdisabled\b/, tag));
  });

  it('has no form, link or handler that could send or change data from the sample cards', () => {
    assert.doesNotMatch(staticHtml, /<form\b/i);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  });

  it('labels the sample cards and does not call anyone verified', () => {
    ['Triage Queue (sample)', 'Provider Verification (sample)', 'System Metrics (sample)'].forEach((h) => {
      assert.ok(html.includes(h), h);
    });
    assert.doesNotMatch(html, /✅/);
  });
});

describe('who can approve or reject (states)', () => {
  const FACILITIES = [{ id: 'fac-001', name: 'Alpha Hospital', hours: 'x', phone: '1234567', address: 'Road 1', services: [] }];
  const pending = () => ({
    id: 'cor-1', facilityId: 'fac-001', field: 'hours', proposedValue: 'Open 24 hours', currentValue: 'x',
    status: 'pending', createdAt: '2026-10-26T10:00:00.000Z', history: []
  });
  const memoryStorage = (data = {}) => ({
    data: { ...data },
    getItem(k) { return k in this.data ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
    removeItem(k) { delete this.data[k]; }
  });
  const fail = (code) => Object.assign(new Error(code), { code });
  const makeStore = (deps) => C.createStore({ facilities: FACILITIES, now: () => Date.parse('2026-10-27T10:00:00Z'), ...deps });
  const approval = { decision: 'approve', actor: 'Mallory', evidence: 'Phoned the front desk today' };

  it('signed out (401): nothing is listed and nothing can be decided, even on a demo host', async () => {
    const api = {
      listFacilityCorrections: async () => { throw fail('unauthenticated'); },
      reviewFacilityCorrection: async () => { throw fail('unauthenticated'); }
    };
    const store = makeStore({ api, storage: memoryStorage(), demo: true });
    assert.strictEqual((await store.list({})).kind, 'unauthenticated');
    assert.strictEqual((await store.review('cor-1', approval)).kind, 'unauthenticated');
  });

  it('signed in but not a moderator (403): same, and the page gets no queue', async () => {
    const api = {
      listFacilityCorrections: async () => { throw fail('forbidden'); },
      reviewFacilityCorrection: async () => { throw fail('forbidden'); }
    };
    const store = makeStore({ api, storage: memoryStorage(), demo: false });
    const list = await store.list({});
    assert.strictEqual(list.ok, false);
    assert.strictEqual(list.kind, 'forbidden');
    assert.strictEqual(list.items, undefined);
    assert.strictEqual((await store.review('cor-1', approval)).kind, 'forbidden');
  });

  it('moderator (server says yes): the server decides, the page sends no name or role', async () => {
    const sent = [];
    const api = {
      listFacilityCorrections: async () => [pending()],
      reviewFacilityCorrection: async (id, body) => { sent.push([id, body]); return { id, status: 'approved' }; }
    };
    const store = makeStore({ api, storage: memoryStorage(), demo: false });
    const list = await store.list({});
    assert.strictEqual(list.ok, true);
    assert.strictEqual(list.mode, 'server');
    assert.strictEqual((await store.review('cor-1', approval)).ok, true);
    assert.deepStrictEqual(Object.keys(sent[0][1]).sort(), ['decision', 'evidence', 'reason']);
  });

  it('no backend on a normal host: refused, and a forged browser queue is ignored', async () => {
    const forged = memoryStorage({
      [C.DEMO_QUEUE_KEY]: JSON.stringify([pending()]),
      isAdmin: 'true', role: 'admin', relief_user: JSON.stringify({ role: 'admin' })
    });
    const store = makeStore({ api: null, storage: forged, demo: false });
    assert.strictEqual((await store.list({})).kind, 'unavailable');
    assert.strictEqual((await store.review('cor-1', approval)).kind, 'unavailable');
    assert.strictEqual(JSON.parse(forged.data[C.DEMO_QUEUE_KEY])[0].status, 'pending');
  });

  it('backend down on a normal host: no fall back to the browser queue', async () => {
    const api = {
      listFacilityCorrections: async () => { throw fail('backend-unavailable'); },
      reviewFacilityCorrection: async () => { throw fail('backend-unavailable'); }
    };
    const store = makeStore({ api, storage: memoryStorage({ [C.DEMO_QUEUE_KEY]: JSON.stringify([pending()]) }), demo: false });
    assert.strictEqual((await store.list({})).kind, 'unavailable');
    assert.strictEqual((await store.review('cor-1', approval)).kind, 'unavailable');
  });

  it('demo host without a backend: works, but only in this browser and marked as demo', async () => {
    const storage = memoryStorage({ [C.DEMO_QUEUE_KEY]: JSON.stringify([pending()]) });
    const store = makeStore({ api: null, storage, demo: true });
    const list = await store.list({});
    assert.strictEqual(list.demo, true);
    const done = await store.review('cor-1', approval);
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.demo, true);
  });
});

describe('browser code holds no secret and no role check', () => {
  const browserFiles = [
    'index.html',
    ...listFiles('pages', ['.html']),
    ...listFiles('profiles', ['.html', '.js']),
    ...listFiles('assets/js', ['.js']),
    'sw.js'
  ];

  it('has no private key, service account, token or live API key in any browser file', () => {
    const patterns = [
      /AIza[0-9A-Za-z_-]{35}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /"private_key"\s*:/,
      /"type"\s*:\s*"service_account"/,
      /\b(sk|rk)_(live|test)_[0-9A-Za-z]{10,}/,
      /\bgh[pousr]_[0-9A-Za-z]{30,}/,
      /\bxox[abprs]-[0-9A-Za-z-]{10,}/,
      /\bAKIA[0-9A-Z]{16}\b/
    ];
    browserFiles.forEach((file) => {
      const text = read(file);
      patterns.forEach((re) => assert.doesNotMatch(text, re, file + ' matches ' + re));
    });
  });

  it('never reads a role or admin flag from browser storage, the URL or a cookie to unlock something', () => {
    const checks = [
      /(?:local|session)Storage\.getItem\(\s*['"`][^'"`]*(?:role|admin|moderator)[^'"`]*['"`]/i,
      /(?:local|session)Storage\[\s*['"`][^'"`]*(?:role|admin|moderator)/i,
      /\.(?:isAdmin|isModerator)\b/,
      /[?&](?:role|admin|isAdmin)=/i
    ];
    listFiles('assets/js', ['.js']).concat(listFiles('profiles', ['.js'])).forEach((file) => {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      checks.forEach((re) => assert.doesNotMatch(code, re, file + ' matches ' + re));
    });
  });

  it('only the placeholder Firebase settings are in the repo, and no page loads that file', () => {
    const config = read('assets/js/firebase-config.js');
    assert.match(config, /apiKey:\s*"your_api_key"/);
    browserFiles.filter((f) => f.endsWith('.html')).forEach((file) => {
      assert.doesNotMatch(read(file), /firebase-config\.js/, file);
    });
  });
});

describe('docs/ADMIN_ACCESS.md', () => {
  it('exists and names every admin control and the server rules', () => {
    const doc = read('docs/ADMIN_ACCESS.md');
    ['Escalate SOS', 'Assign Doctor', 'Approve', 'Reject', 'Refresh', 'custom claim', 'firestore.rules', 'Not done'].forEach((word) => {
      assert.ok(doc.includes(word), word);
    });
  });
});
