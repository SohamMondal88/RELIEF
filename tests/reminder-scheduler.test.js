/**
 * Reminder due-check loop (Issue #183).
 *
 * Runs the scheduler with node:test fake timers and a fake clock, so nothing here waits in real
 * time. Covers: starting twice, two schedulers sharing one storage (two tabs), overdue reminders
 * after sleep, stop() cleaning up, a browser that refuses to save, and the dashboard wiring.
 *
 * node --test tests/reminder-scheduler.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../assets/js/reminders.js');
const { createScheduler } = require('../assets/js/reminder-scheduler.js');

const ROOT = path.join(__dirname, '..');
const ZONE = 'Asia/Kolkata';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// 07:00 on 2026-03-10 in Asia/Kolkata (01:30 UTC).
const START = Date.parse('2026-03-10T01:30:00Z');

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); }
  };
}

function reminder(extra) {
  return Object.assign({ id: 'r1', medicine: 'Vitamin D', time: '08:00', status: 'active', scheduleMode: 'local', timeZone: ZONE }, extra);
}

function storageWith(list) {
  return memoryStorage({ [R.REMINDERS_KEY]: JSON.stringify(list) });
}

/** A tiny event target that also counts the listeners left on it. */
function fakeTarget(extra) {
  const listeners = {};
  return Object.assign({
    addEventListener(type, fn) { (listeners[type] = listeners[type] || new Set()).add(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type].delete(fn); },
    emit(type, event) { (listeners[type] ? [...listeners[type]] : []).forEach((fn) => fn(event || {})); },
    count() { return Object.values(listeners).reduce((n, set) => n + set.size, 0); }
  }, extra);
}

/** Wraps the (fake) global timers so a test can see how many intervals are still alive. */
function trackedTimers() {
  const live = new Set();
  return {
    live,
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); live.add(id); return id; },
    clearInterval: (id) => { live.delete(id); clearInterval(id); }
  };
}

function setup(t, list, extra) {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: START });
  const storage = (extra && extra.storage) || storageWith(list);
  const timers = trackedTimers();
  const delivered = [];
  const docTarget = fakeTarget({ visibilityState: 'visible' });
  const winTarget = fakeTarget();
  const make = (more) => createScheduler(Object.assign({
    storage,
    timeZone: ZONE,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    documentTarget: docTarget,
    windowTarget: winTarget,
    deliver: (due) => delivered.push(due.map((r) => r.id))
  }, more));
  return { storage, timers, delivered, docTarget, winTarget, make };
}

const stored = (storage) => JSON.parse(storage.getItem(R.REMINDERS_KEY));

test('starting twice keeps one timer and one set of listeners', (t) => {
  const s = setup(t, [reminder()]);
  const sch = s.make();
  assert.strictEqual(sch.start(), true);
  assert.strictEqual(sch.start(), false);
  assert.strictEqual(sch.start(), false);
  assert.strictEqual(s.timers.live.size, 1);
  assert.strictEqual(s.docTarget.count(), 1);
  assert.strictEqual(s.winTarget.count(), 2);

  // 08:00 passes: exactly one delivery, however many times start() was called.
  t.mock.timers.tick(90 * MIN);
  assert.deepStrictEqual(s.delivered, [['r1']]);
  sch.stop();
});

test('stop() clears the timer and removes the listeners, and nothing fires afterwards', (t) => {
  const s = setup(t, [reminder()]);
  const sch = s.make();
  sch.start();
  assert.strictEqual(sch.isRunning(), true);
  assert.strictEqual(sch.stop(), true);
  assert.strictEqual(sch.stop(), false);
  assert.strictEqual(sch.isRunning(), false);
  assert.strictEqual(s.timers.live.size, 0);
  assert.strictEqual(s.docTarget.count(), 0);
  assert.strictEqual(s.winTarget.count(), 0);

  t.mock.timers.tick(3 * HOUR);
  s.docTarget.emit('visibilitychange');
  s.winTarget.emit('pageshow');
  assert.deepStrictEqual(s.delivered, []);
});

test('start() works again after stop(), with a single timer', (t) => {
  const s = setup(t, [reminder()]);
  const sch = s.make();
  sch.start();
  sch.stop();
  assert.strictEqual(sch.start(), true);
  assert.strictEqual(s.timers.live.size, 1);
  assert.strictEqual(s.docTarget.count(), 1);
  sch.stop();
});

test('two schedulers on one storage (two tabs) deliver a due reminder once', (t) => {
  const s = setup(t, [reminder()]);
  const tabA = s.make({ deliver: (due) => s.delivered.push('A:' + due[0].id) });
  const tabB = s.make({ deliver: (due) => s.delivered.push('B:' + due[0].id) });
  tabA.start();
  tabB.start();
  assert.strictEqual(s.timers.live.size, 2);

  t.mock.timers.tick(2 * HOUR);
  assert.strictEqual(s.delivered.length, 1);
  assert.strictEqual(stored(s.storage)[0].lastNotifiedOn, '2026-03-10');
  tabA.stop();
  tabB.stop();
});

test('the mark is saved before the reminder is delivered', (t) => {
  const s = setup(t, [reminder({ time: '07:00' })]);
  let seenAtDelivery = null;
  const sch = s.make({ deliver: () => { seenAtDelivery = stored(s.storage)[0].lastNotifiedOn; } });
  sch.start();
  assert.strictEqual(seenAtDelivery, '2026-03-10');
  sch.stop();
});

test('a tab never overwrites the other tab\'s mark with its own older copy', (t) => {
  const s = setup(t, [reminder(), reminder({ id: 'r2', medicine: 'Iron', time: '09:00' })]);
  const tabA = s.make({ deliver: (due) => s.delivered.push('A:' + due.map((r) => r.id)) });
  const tabB = s.make({ deliver: (due) => s.delivered.push('B:' + due.map((r) => r.id)) });
  tabA.start();
  tabB.start();

  // r1 fires (in whichever tab checks first), then r2 fires later. Both marks must survive.
  t.mock.timers.tick(90 * MIN);
  t.mock.timers.tick(60 * MIN);
  const list = stored(s.storage);
  assert.strictEqual(list.find((r) => r.id === 'r1').lastNotifiedOn, '2026-03-10');
  assert.strictEqual(list.find((r) => r.id === 'r2').lastNotifiedOn, '2026-03-10');
  assert.strictEqual(s.delivered.length, 2);
  tabA.stop();
  tabB.stop();
});

test('a reminder that became overdue during sleep fires once on resume, not once per tab and wake event', (t) => {
  const s = setup(t, [reminder()]);
  const tabA = s.make();
  const tabB = s.make();
  tabA.start();
  tabB.start();

  // The device sleeps through 08:00 and wakes at 11:30. No interval tick ran, only the clock moved.
  t.mock.timers.setTime(START + 4.5 * HOUR);
  assert.deepStrictEqual(s.delivered, []);
  s.docTarget.emit('visibilitychange');
  s.winTarget.emit('pageshow');
  s.docTarget.emit('visibilitychange');
  assert.deepStrictEqual(s.delivered, [['r1']]);

  // The ordinary timer tick after waking does not repeat it either.
  t.mock.timers.tick(30 * 1000);
  assert.strictEqual(s.delivered.length, 1);
  tabA.stop();
  tabB.stop();
});

test('a hidden tab does not check on visibilitychange', (t) => {
  const s = setup(t, [reminder()]);
  const sch = s.make();
  sch.start();
  t.mock.timers.setTime(START + 2 * HOUR);
  s.docTarget.visibilityState = 'hidden';
  s.docTarget.emit('visibilitychange');
  assert.deepStrictEqual(s.delivered, []);
  s.docTarget.visibilityState = 'visible';
  s.docTarget.emit('visibilitychange');
  assert.deepStrictEqual(s.delivered, [['r1']]);
  sch.stop();
});

test('after a reload the reminder that already fired today does not fire again', (t) => {
  const s = setup(t, [reminder()]);
  const first = s.make();
  first.start();
  t.mock.timers.tick(90 * MIN);
  assert.strictEqual(s.delivered.length, 1);
  first.stop();

  const reloaded = s.make();
  reloaded.start();
  t.mock.timers.tick(HOUR);
  assert.strictEqual(s.delivered.length, 1);
  reloaded.stop();
});

test('reminders changed in storage (edited in another tab) are picked up on the next check', (t) => {
  const s = setup(t, [reminder()]);
  const sch = s.make();
  sch.start();
  // The other tab edits the time and the pause state; this tab has no copy of its own to hold on to.
  s.storage.setItem(R.REMINDERS_KEY, JSON.stringify([reminder({ status: 'paused' })]));
  t.mock.timers.tick(2 * HOUR);
  assert.deepStrictEqual(s.delivered, []);
  s.storage.setItem(R.REMINDERS_KEY, JSON.stringify([reminder({ status: 'active' })]));
  t.mock.timers.tick(30 * 1000);
  assert.deepStrictEqual(s.delivered, [['r1']]);
  sch.stop();
});

test('a storage event from another tab hands the page the newer list, and others keys are ignored', (t) => {
  const s = setup(t, [reminder()]);
  const seen = [];
  const sch = s.make({ onChange: (list, saved) => seen.push([list.length, saved]) });
  sch.start();
  s.storage.setItem(R.REMINDERS_KEY, JSON.stringify([reminder(), reminder({ id: 'r2', time: '23:00', medicine: 'Iron' })]));
  s.winTarget.emit('storage', { key: 'something_else' });
  assert.deepStrictEqual(seen, []);
  s.winTarget.emit('storage', { key: R.REMINDERS_KEY });
  assert.deepStrictEqual(seen, [[2, true]]);
  sch.stop();
});

test('when the browser refuses to save, the reminder still fires once and the page is told', (t) => {
  const base = storageWith([reminder()]);
  const blocked = { getItem: base.getItem, setItem: () => { throw new Error('QuotaExceededError'); } };
  const s = setup(t, null, { storage: blocked });
  const changes = [];
  const sch = s.make({ onChange: (list, saved) => changes.push(saved) });
  sch.start();
  t.mock.timers.tick(2 * HOUR);
  t.mock.timers.tick(HOUR);
  assert.deepStrictEqual(s.delivered, [['r1']]);
  assert.deepStrictEqual(changes, [false]);
  sch.stop();
});

test('with nothing due, nothing is written and nothing is delivered', (t) => {
  const writes = [];
  const base = storageWith([reminder()]);
  const storage = { getItem: base.getItem, setItem: (k, v) => { writes.push(k); base.setItem(k, v); } };
  const s = setup(t, null, { storage });
  const sch = s.make();
  sch.start();
  t.mock.timers.tick(20 * MIN);
  assert.deepStrictEqual(writes, []);
  assert.deepStrictEqual(s.delivered, []);
  sch.stop();
});

test('a fixed time zone reminder is checked on its own clock', (t) => {
  const s = setup(t, [reminder({ scheduleMode: 'fixed', timeZone: 'America/New_York', time: '22:00' })]);
  const sch = s.make();
  sch.start();
  // 2026-03-10 07:00 in Kolkata is 21:30 the evening before in New York (EDT, UTC-4): not yet 22:00 there.
  t.mock.timers.tick(20 * MIN);
  assert.deepStrictEqual(s.delivered, []);
  t.mock.timers.tick(20 * MIN);
  assert.deepStrictEqual(s.delivered, [['r1']]);
  assert.strictEqual(stored(s.storage)[0].lastNotifiedOn, '2026-03-09');
  sch.stop();
});

test('the dashboard loads the scheduler between reminders.js and dashboard.js and no longer runs its own timer', () => {
  const html = fs.readFileSync(path.join(ROOT, 'pages', 'dashboard.html'), 'utf8');
  const a = html.indexOf('reminders.js');
  const b = html.indexOf('reminder-scheduler.js');
  const c = html.indexOf('dashboard.js');
  assert.ok(a > -1 && a < b && b < c);

  const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8');
  assert.doesNotMatch(js, /setInterval\(checkDue/);
  assert.match(js, /scheduler\.start\(\)/);
});

test('the scheduling doc describes the two tab behaviour and keeps the dashboard open note', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'REMINDER_SCHEDULING.md'), 'utf8');
  assert.match(doc, /more than one tab/i);
  assert.match(doc, /only fire while/);
});
