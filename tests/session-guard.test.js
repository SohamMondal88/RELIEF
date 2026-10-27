/**
 * Tests for session expiry and cross-tab logout (Issue #57).
 *
 * node --test tests/session-guard.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Guard = require('../assets/js/session-guard.js');

const KEY = 'relief_auth_sessions';
const MIN = 60 * 1000;

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    raw: () => data
  };
}

function makeSession(now, overrides) {
  return Object.assign({
    token: 'secret-token-value',
    user: { uid: 'u1', email: 'person@example.com' },
    deviceType: 'desktop',
    createdAt: now,
    lastActiveAt: now,
    expiresAt: now + 7 * 24 * 60 * MIN
  }, overrides);
}

/** Several "tabs" sharing storage and a message bus, like a real browser profile. */
function browser() {
  const storage = memoryStorage();
  const clock = { t: 10_000_000 };
  const channels = [];
  const tabs = [];

  function newTab(extra) {
    const events = {};
    const target = {
      addEventListener: (name, fn) => { (events[name] = events[name] || []).push(fn); },
      removeEventListener: (name, fn) => { events[name] = (events[name] || []).filter((f) => f !== fn); },
      fire: (name, event) => (events[name] || []).forEach((fn) => fn(event))
    };
    const intervals = [];
    const ended = [];
    const channel = {
      onmessage: null,
      postMessage(message) {
        channels.filter((c) => c !== channel).forEach((c) => c.onmessage && c.onmessage({ data: message }));
      },
      close() {}
    };
    channels.push(channel);

    const watcher = Guard.createSessionWatcher(Object.assign({
      storage,
      now: () => clock.t,
      target,
      doc: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
      createChannel: () => channel,
      timers: {
        setInterval: (fn) => { intervals.push(fn); return intervals.length; },
        clearInterval: () => {}
      },
      onEnded: (reason, info) => ended.push({ reason, remote: info.remote })
    }, extra));
    const tab = { watcher, target, ended, tick: () => intervals.forEach((fn) => fn()) };
    tabs.push(tab);
    return tab;
  }

  return { storage, clock, newTab, signIn: (overrides) => storage.setItem(KEY, JSON.stringify([makeSession(clock.t, overrides)])) };
}

// ---------- Expiry policy ----------

test('a fresh session is valid', () => {
  const now = 1_000_000;
  assert.strictEqual(Guard.evaluateSession(makeSession(now), now).valid, true);
});

test('idle timeout ends the session with reason "idle"', () => {
  const now = 5_000_000;
  const session = makeSession(now - 31 * MIN, { lastActiveAt: now - 31 * MIN });
  const result = Guard.evaluateSession(session, now);
  assert.deepStrictEqual(result, { valid: false, reason: 'idle' });
});

test('activity within the idle window keeps the session valid', () => {
  const now = 5_000_000;
  const session = makeSession(now - 60 * MIN, { lastActiveAt: now - 5 * MIN });
  assert.strictEqual(Guard.evaluateSession(session, now).valid, true);
});

test('absolute lifetime ends even an active session with reason "expired"', () => {
  const now = 900_000_000;
  const eightDays = 8 * 24 * 60 * MIN;
  const session = makeSession(now - eightDays, { lastActiveAt: now - MIN, expiresAt: now + MIN });
  assert.deepStrictEqual(Guard.evaluateSession(session, now), { valid: false, reason: 'expired' });
});

test('the stored expiresAt is honoured', () => {
  const now = 5_000_000;
  const session = makeSession(now, { expiresAt: now - 1 });
  assert.strictEqual(Guard.evaluateSession(session, now).valid, false);
});

test('malformed or tampered sessions are never valid', () => {
  const now = 5_000_000;
  [null, undefined, 'x', 5, {}, { user: {} }, makeSession(now, { createdAt: 'yesterday' }),
    makeSession(now, { lastActiveAt: NaN })].forEach((bad) => {
    assert.strictEqual(Guard.evaluateSession(bad, now).valid, false);
  });
});

test('timestamps far in the future (clock changed or edited) are rejected', () => {
  const now = 5_000_000;
  assert.strictEqual(Guard.evaluateSession(makeSession(now, { createdAt: now + 60 * MIN }), now).valid, false);
  assert.strictEqual(Guard.evaluateSession(makeSession(now, { lastActiveAt: now + 60 * MIN }), now).valid, false);
  // small skew is tolerated
  assert.strictEqual(Guard.evaluateSession(makeSession(now, { lastActiveAt: now + MIN }), now).valid, true);
});

test('timeouts are configurable and bad values fall back to defaults', () => {
  const cfg = Guard.resolveConfig({ idleTimeoutMs: 1000, absoluteTimeoutMs: -1 }, { idleTimeoutMs: 9999 });
  assert.strictEqual(cfg.idleTimeoutMs, 1000);
  assert.strictEqual(cfg.absoluteTimeoutMs, Guard.DEFAULTS.absoluteTimeoutMs);
  const now = 5_000_000;
  const session = makeSession(now - 2000, { lastActiveAt: now - 2000 });
  assert.strictEqual(Guard.evaluateSession(session, now, cfg).reason, 'idle');
});

// ---------- Expiry while a tab is open ----------

test('an open tab is told when its session goes idle', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  assert.strictEqual(tab.watcher.start(), true);

  b.clock.t += 31 * MIN;
  tab.tick();

  assert.deepStrictEqual(tab.ended, [{ reason: 'idle', remote: false }]);
  assert.strictEqual(b.storage.getItem(KEY), null, 'the dead session is removed from storage');
});

test('the end notification fires once only', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  tab.watcher.start();
  b.clock.t += 40 * MIN;
  tab.tick();
  tab.tick();
  tab.target.fire('focus');
  assert.strictEqual(tab.ended.length, 1);
});

test('activity extends the idle window (throttled writes)', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  tab.watcher.start();

  for (let i = 0; i < 4; i++) {
    b.clock.t += 20 * MIN; // 80 minutes in total, but never idle for 30
    tab.target.fire('pointerdown');
    tab.tick();
  }
  assert.strictEqual(tab.ended.length, 0);
  assert.ok(JSON.parse(b.storage.getItem(KEY))[0].lastActiveAt > 10_000_000 + 60 * MIN);
});

test('activity cannot bring back an already expired session', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  tab.watcher.start();
  b.clock.t += 45 * MIN;
  tab.target.fire('keydown'); // activity arrives after the idle limit
  assert.deepStrictEqual(tab.ended.map((e) => e.reason), ['idle']);
  assert.strictEqual(b.storage.getItem(KEY), null);
});

test('returning to a hidden tab re-checks the session immediately', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  tab.watcher.start();
  b.clock.t += 31 * MIN;
  tab.target.fire('focus');
  assert.strictEqual(tab.ended[0].reason, 'idle');
});

test('a tab opened with an already expired stored session cleans it silently', () => {
  const b = browser();
  b.signIn({ createdAt: b.clock.t - 60 * MIN, lastActiveAt: b.clock.t - 60 * MIN });
  const tab = b.newTab();
  assert.strictEqual(tab.watcher.start(), false);
  assert.strictEqual(b.storage.getItem(KEY), null);
  b.clock.t += MIN;
  tab.tick();
  assert.strictEqual(tab.ended.length, 0, 'anonymous visitors are not interrupted');
});

// ---------- Cross-tab logout ----------

test('signing out in one tab ends every other open tab', () => {
  const b = browser();
  b.signIn();
  const a = b.newTab();
  const other = b.newTab();
  const third = b.newTab();
  [a, other, third].forEach((t) => t.watcher.start());

  a.watcher.signOut();

  assert.strictEqual(a.ended.length, 0, 'the tab that signed out is already leaving');
  assert.deepStrictEqual(other.ended, [{ reason: 'signed-out', remote: true }]);
  assert.deepStrictEqual(third.ended, [{ reason: 'signed-out', remote: true }]);
  assert.strictEqual(b.storage.getItem(KEY), null);
});

test('cross-tab logout still works without BroadcastChannel (storage event only)', () => {
  const b = browser();
  b.signIn();
  const noChannel = () => null;
  const a = b.newTab({ createChannel: noChannel });
  const other = b.newTab({ createChannel: noChannel });
  a.watcher.start();
  other.watcher.start();

  b.storage.removeItem(KEY); // what another tab's logout does
  other.target.fire('storage', { key: KEY });

  assert.deepStrictEqual(other.ended.map((e) => e.reason), ['signed-out']);
});

test('storage.clear() in another tab (event key null) also ends the session', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab({ createChannel: () => null });
  tab.watcher.start();
  b.storage.removeItem(KEY);
  tab.target.fire('storage', { key: null });
  assert.strictEqual(tab.ended.length, 1);
});

test('unrelated storage changes are ignored', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  tab.watcher.start();
  tab.target.fire('storage', { key: 'relief_lang' });
  assert.strictEqual(tab.ended.length, 0);
});

test('a tab that was never signed in is not affected by a logout elsewhere', () => {
  const b = browser();
  const anonymous = b.newTab();
  anonymous.watcher.start();
  const signedIn = (b.signIn(), b.newTab());
  signedIn.watcher.start();
  signedIn.watcher.signOut();
  assert.strictEqual(anonymous.ended.length, 0, 'its page must not be wiped or interrupted');
});

// ---------- Refresh failure ----------

test('a failed refresh ends the session and tells other tabs', async () => {
  const b = browser();
  b.signIn();
  const failing = b.newTab({ refresh: async () => { throw new Error('auth/user-token-expired'); } });
  const other = b.newTab();
  failing.watcher.start();
  other.watcher.start();

  await failing.watcher.refreshNow();

  assert.deepStrictEqual(failing.ended.map((e) => e.reason), ['refresh-failed']);
  assert.deepStrictEqual(other.ended.map((e) => e.reason), ['refresh-failed']);
  assert.strictEqual(b.storage.getItem(KEY), null);
});

test('a successful refresh keeps the session', async () => {
  const b = browser();
  b.signIn();
  let calls = 0;
  const tab = b.newTab({ refresh: async () => { calls++; } });
  tab.watcher.start();
  await tab.watcher.refreshNow();
  assert.strictEqual(calls, 1);
  assert.strictEqual(tab.ended.length, 0);
});

test('refresh runs on the interval, not on every check, and never overlaps', async () => {
  const b = browser();
  b.signIn();
  let calls = 0;
  let release;
  const slow = () => new Promise((resolve) => { calls++; release = resolve; });
  const tab = b.newTab({ refresh: slow, config: { refreshIntervalMs: 10 * MIN } });
  tab.watcher.start();

  tab.tick(); // too soon
  assert.strictEqual(calls, 0);

  b.clock.t += 11 * MIN;
  tab.target.fire('pointerdown'); // keep the session active
  tab.tick();
  tab.tick(); // first one still running
  assert.strictEqual(calls, 1);
  release();
});

test('no refresh function means no refresh', async () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab();
  tab.watcher.start();
  await tab.watcher.refreshNow();
  assert.strictEqual(tab.ended.length, 0);
});

// ---------- Safety ----------

test('a throwing onEnded handler cannot keep the session alive', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab({ onEnded: () => { throw new Error('ui failed'); } });
  tab.watcher.start();
  b.clock.t += 31 * MIN;
  assert.doesNotThrow(() => tab.tick());
  assert.strictEqual(b.storage.getItem(KEY), null);
});

test('corrupt stored data is treated as no session', () => {
  const b = browser();
  b.storage.setItem(KEY, '{broken');
  const tab = b.newTab();
  assert.strictEqual(tab.watcher.start(), false);
});

test('blocked storage does not throw', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); }
  };
  const watcher = Guard.createSessionWatcher({ storage: broken, timers: { setInterval: () => 1, clearInterval() {} } });
  assert.doesNotThrow(() => { watcher.start(); watcher.checkNow(); watcher.stop(); });
});

test('stop() removes listeners so a finished page cannot react', () => {
  const b = browser();
  b.signIn();
  const tab = b.newTab({ createChannel: () => null });
  tab.watcher.start();
  tab.watcher.stop();
  b.storage.removeItem(KEY);
  tab.target.fire('storage', { key: KEY });
  assert.strictEqual(tab.ended.length, 0);
});

test('the module never writes tokens or user data to the console', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'session-guard.js'), 'utf8');
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(source));
});

test('messages shown to the user do not include the session or account details', () => {
  Object.values(Guard.REASONS).forEach((reason) => {
    const message = Guard.messageFor(reason);
    assert.ok(!/token|@|uid|relief_/i.test(message));
  });
  assert.ok(Guard.messageFor('something-else').length > 0);
});

// ---------- Page behaviour (protected content and prompt) ----------

function fakeDocument() {
  const nodes = [];
  function el(tag) {
    const e = {
      tag, children: [], attrs: {}, style: {}, textContent: '', id: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      get firstChild() { return this.children[0] || null; },
      focus() { this.focused = true; }
    };
    return e;
  }
  const protectedNode = el('main');
  protectedNode.children = [el('p'), el('p')];
  const body = el('body');
  return {
    protectedNode, body,
    createElement: el,
    getElementById: (id) => body.children.find((c) => c.id === id) || null,
    querySelectorAll: (sel) => (sel === '[data-protected]' ? [protectedNode] : []),
    querySelector: (sel) => (sel === '[data-protected]' ? protectedNode : null)
  };
}

test('ending a session empties protected regions and shows an accessible sign-in prompt', () => {
  const doc = fakeDocument();
  Guard.handleSessionEnded('idle', doc);

  assert.strictEqual(doc.protectedNode.children.length, 0);
  assert.strictEqual(doc.protectedNode.attrs['aria-hidden'], 'true');

  const prompt = doc.getElementById('relief-session-ended');
  assert.ok(prompt);
  assert.strictEqual(prompt.attrs.role, 'alertdialog');
  assert.strictEqual(prompt.attrs['aria-modal'], 'true');
  const box = prompt.children[0];
  const link = box.children[2];
  assert.match(link.href, /login\.html$/);
  assert.strictEqual(link.focused, true);
  assert.match(box.children[1].textContent, /inactive/);
});

test('the prompt is shown once even if several signals arrive', () => {
  const doc = fakeDocument();
  Guard.handleSessionEnded('expired', doc);
  Guard.handleSessionEnded('signed-out', doc);
  assert.strictEqual(doc.body.children.length, 1);
});

test('pages without protected content are not interrupted', () => {
  const doc = fakeDocument();
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  Guard.handleSessionEnded('idle', doc);
  assert.strictEqual(doc.body.children.length, 0);
});

// ---------- Wiring ----------

test('every page that loads main.js loads session-guard.js first', () => {
  const root = path.join(__dirname, '..');
  const pages = ['index.html']
    .concat(fs.readdirSync(path.join(root, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f));
  let checked = 0;
  pages.forEach((page) => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const main = html.indexOf('assets/js/main.js');
    if (main === -1) return;
    const guard = html.indexOf('assets/js/session-guard.js');
    assert.ok(guard !== -1 && guard < main, page + ' must load session-guard.js before main.js');
    checked++;
  });
  assert.ok(checked >= 10);
});

test('the dashboard marks its content as protected', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard.html'), 'utf8');
  assert.match(html, /<main[^>]*data-protected/);
});

test('the service worker caches session-guard.js and the cache version was bumped', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /assets\/js\/session-guard\.js/);
  assert.doesNotMatch(sw, /CACHE_VERSION = 'v[12]'/);
});

test('sign-out goes through the guard so other tabs hear about it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'main.js'), 'utf8');
  assert.match(main, /ReliefSessionGuard\?\.signOutEverywhere/);
  const api = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'api.js'), 'utf8');
  assert.match(api, /refreshSession/);
});
