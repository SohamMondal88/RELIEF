/**
 * Consent-based reminder notifications (Issue #63).
 *
 * Covers: the user's choice kept apart from the browser permission, asking only after a click,
 * denied or unsupported browsers, turning notifications off and on again, permission changes,
 * and the content of a notification (generic by default, no notes ever).
 *
 * node --test tests/notification-prefs.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const NP = require('../assets/js/notification-prefs.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ---------------------------------------------------------------------------
// Test doubles. A fresh set is built per test so permission state never leaks between tests.
// ---------------------------------------------------------------------------

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

/**
 * A stand-in for window.Notification.
 * answer: what the browser prompt returns ('granted' | 'denied' | 'default' for "dismissed"),
 * style: 'promise' (modern), 'callback' (legacy, returns nothing) or 'reject' / 'throw'.
 */
function fakeNotification(permission, options) {
  const opts = options || {};
  const state = { shown: [], asked: 0 };

  function Fake(title, init) {
    if (opts.constructorThrows) throw new Error('Illegal constructor');
    state.shown.push({ title, body: init && init.body, tag: init && init.tag });
  }
  Fake.permission = permission;
  Fake.state = state;
  if (opts.noRequest !== true) {
    Fake.requestPermission = function (callback) {
      state.asked += 1;
      const answer = opts.answer || 'granted';
      if (opts.style === 'throw') throw new Error('not allowed here');
      if (opts.style === 'reject') return Promise.reject(new Error('blocked'));
      if (opts.style === 'callback') {
        Fake.permission = answer;
        if (callback) callback(answer);
        return undefined;
      }
      Fake.permission = answer;
      return Promise.resolve(answer);
    };
  }
  return Fake;
}

const reminder = (extra) => Object.assign({ id: 'r1', medicine: 'Metformin 500mg', time: '08:00', instructions: 'after breakfast, for diabetes' }, extra);

// ---------------------------------------------------------------------------
// Preference and permission are separate: every combination
// ---------------------------------------------------------------------------

const MATRIX = [
  // [browser pref, permission, expected state, browser notification shown?]
  [false, 'default', 'off', false],
  [false, 'granted', 'off', false],
  [false, 'denied', 'off', false],
  [false, 'unsupported', 'unsupported', false],
  [true, 'default', 'needs-permission', false],
  [true, 'granted', 'active', true],
  [true, 'denied', 'blocked', false],
  [true, 'unsupported', 'unsupported', false]
];

MATRIX.forEach(([browser, permission, state, shows]) => {
  test('[plan] preference ' + (browser ? 'on' : 'off') + ' + permission ' + permission + ' = ' + state, () => {
    const plan = NP.getPlan({ browser, showDetails: false }, permission);
    assert.strictEqual(plan.state, state);
    assert.strictEqual(plan.browser, shows, 'browser notifications ' + (shows ? 'should' : 'must not') + ' be sent');
    assert.strictEqual(plan.inApp, true, 'the in-page reminder always happens');
    assert.ok(plan.message.length > 20);
  });
});

test('[plan] the message says what to do, and never blames the user', () => {
  assert.match(NP.getPlan({ browser: true }, 'denied').message, /allow them for this site in your browser settings/);
  assert.match(NP.getPlan({ browser: true }, 'default').message, /not been asked yet/);
  assert.match(NP.getPlan({ browser: true }, 'unsupported').message, /does not support/);
  assert.match(NP.getPlan({ browser: false }, 'granted').message, /turn this back on at any time/);
  assert.match(NP.getPlan({ browser: false }, 'denied').message, /blocking notifications for this site/);
});

test('[plan] bad preference values are treated as off', () => {
  [null, undefined, 'yes', 5, [], { browser: 'true' }, { browser: 1 }, { browser: null }].forEach((prefs) => {
    assert.strictEqual(NP.getPlan(prefs, 'granted').browser, false, JSON.stringify(prefs));
  });
});

// ---------------------------------------------------------------------------
// Stored preferences
// ---------------------------------------------------------------------------

test('[prefs] everything is off until the user chooses', () => {
  assert.deepStrictEqual(NP.loadPrefs(memoryStorage()), { browser: false, showDetails: false });
  assert.deepStrictEqual(NP.DEFAULT_PREFS, { browser: false, showDetails: false });
});

test('[prefs] saved choices are read back; unknown fields are dropped', () => {
  const store = memoryStorage();
  assert.strictEqual(NP.savePrefs(store, { browser: true, showDetails: true, extra: 'x' }), true);
  assert.deepStrictEqual(JSON.parse(store.data[NP.PREFS_KEY]), { browser: true, showDetails: true });
  assert.deepStrictEqual(NP.loadPrefs(store), { browser: true, showDetails: true });
});

test('[prefs] corrupt or wrongly typed storage falls back to off', () => {
  ['{broken', 'null', '[]', '"yes"', '{"browser":"true","showDetails":1}'].forEach((raw) => {
    const prefs = NP.loadPrefs(memoryStorage({ [NP.PREFS_KEY]: raw }));
    assert.deepStrictEqual(prefs, { browser: false, showDetails: false }, raw);
  });
});

test('[prefs] blocked or full storage does not throw', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepStrictEqual(NP.loadPrefs(broken), { browser: false, showDetails: false });
  assert.strictEqual(NP.savePrefs(broken, { browser: true }), false);
  assert.deepStrictEqual(NP.loadPrefs(null), { browser: false, showDetails: false });
});

// ---------------------------------------------------------------------------
// Asking for permission: only after the user presses the button
// ---------------------------------------------------------------------------

test('[consent] reading preferences and building a plan never asks the browser', () => {
  const N = fakeNotification('default');
  NP.loadPrefs(memoryStorage());
  NP.getPlan({ browser: true }, NP.getPermission(N));
  NP.deliver([reminder()], N, { browser: true });
  assert.strictEqual(N.state.asked, 0);
});

test('[consent] pressing "turn on" asks once and records the choice when the browser agrees', async () => {
  const N = fakeNotification('default', { answer: 'granted' });
  const store = memoryStorage();
  const result = await NP.enableBrowserNotifications(N, store);

  assert.strictEqual(N.state.asked, 1);
  assert.strictEqual(result.asked, true);
  assert.strictEqual(result.permission, 'granted');
  assert.strictEqual(result.prefs.browser, true);
  assert.strictEqual(result.plan.state, 'active');
  assert.strictEqual(NP.loadPrefs(store).browser, true, 'saved for the next visit');
});

test('[consent] the browser says no: the choice stays off and reminders still show on the page', async () => {
  const N = fakeNotification('default', { answer: 'denied' });
  const store = memoryStorage();
  const result = await NP.enableBrowserNotifications(N, store);

  assert.strictEqual(result.permission, 'denied');
  assert.strictEqual(result.prefs.browser, false);
  assert.strictEqual(NP.loadPrefs(store).browser, false, 'we never record "on" when the browser refused');
  const delivery = NP.deliver([reminder()], N, result.prefs);
  assert.strictEqual(delivery.browser, 'skipped');
  assert.strictEqual(delivery.inApp.length, 1);
});

test('[consent] the prompt is dismissed without an answer: nothing is turned on', async () => {
  const N = fakeNotification('default', { answer: 'default' });
  const result = await NP.enableBrowserNotifications(N, memoryStorage());
  assert.strictEqual(result.prefs.browser, false);
  assert.strictEqual(result.permission, 'default');
});

test('[consent] older browsers that use a callback instead of a promise work', async () => {
  const N = fakeNotification('default', { answer: 'granted', style: 'callback' });
  const result = await NP.enableBrowserNotifications(N, memoryStorage());
  assert.strictEqual(result.prefs.browser, true);
});

test('[consent] a browser that throws or rejects does not break the page or turn anything on', async () => {
  for (const style of ['throw', 'reject']) {
    const N = fakeNotification('default', { style });
    const result = await NP.enableBrowserNotifications(N, memoryStorage());
    assert.strictEqual(result.prefs.browser, false, style);
    assert.strictEqual(result.plan.inApp, true, style);
  }
});

test('[consent] already allowed: turning on does not ask again', async () => {
  const N = fakeNotification('granted');
  const result = await NP.enableBrowserNotifications(N, memoryStorage());
  assert.strictEqual(N.state.asked, 0);
  assert.strictEqual(result.asked, false);
  assert.strictEqual(result.prefs.browser, true);
});

test('[consent] already blocked: we do not ask (the browser would ignore it) and we do not claim it is on', async () => {
  const N = fakeNotification('denied');
  const result = await NP.enableBrowserNotifications(N, memoryStorage());
  assert.strictEqual(N.state.asked, 0);
  assert.strictEqual(result.prefs.browser, false);
});

test('[consent] a browser without notifications: the choice stays off, no error', async () => {
  const result = await NP.enableBrowserNotifications(undefined, memoryStorage());
  assert.strictEqual(result.prefs.browser, false);
  assert.strictEqual(result.plan.state, 'unsupported');
  const noRequest = fakeNotification('default', { noRequest: true });
  assert.strictEqual((await NP.enableBrowserNotifications(noRequest, memoryStorage())).prefs.browser, false);
});

// ---------------------------------------------------------------------------
// Changing or revoking the choice
// ---------------------------------------------------------------------------

test('[revoke] turning off stops notifications at once, even though the browser still allows them', async () => {
  const N = fakeNotification('granted');
  const store = memoryStorage();
  await NP.enableBrowserNotifications(N, store);
  assert.strictEqual(NP.deliver([reminder()], N, NP.loadPrefs(store)).browser, 'sent');

  const off = NP.disableBrowserNotifications(N, store);
  assert.strictEqual(off.prefs.browser, false);
  assert.strictEqual(off.permission, 'granted', 'we cannot revoke the browser permission from a page');
  assert.strictEqual(off.plan.state, 'off');

  const after = NP.deliver([reminder()], N, NP.loadPrefs(store));
  assert.strictEqual(after.browser, 'skipped');
  assert.strictEqual(N.state.shown.length, 1, 'only the first reminder produced a notification');
  assert.strictEqual(after.inApp.length, 1, 'the page still shows it');
});

test('[revoke] turning back on after turning off does not ask again while the browser still allows it', async () => {
  const N = fakeNotification('granted');
  const store = memoryStorage();
  await NP.enableBrowserNotifications(N, store);
  NP.disableBrowserNotifications(N, store);
  const again = await NP.enableBrowserNotifications(N, store);
  assert.strictEqual(N.state.asked, 0);
  assert.strictEqual(again.plan.state, 'active');
});

test('[revoke] the browser permission is withdrawn later: notifications stop and the page keeps working', async () => {
  const N = fakeNotification('granted');
  const store = memoryStorage();
  await NP.enableBrowserNotifications(N, store);

  N.permission = 'denied'; // the user changed it in the browser's site settings
  const plan = NP.getPlan(NP.loadPrefs(store), NP.getPermission(N));
  assert.strictEqual(plan.state, 'blocked');
  const delivery = NP.deliver([reminder()], N, NP.loadPrefs(store));
  assert.strictEqual(delivery.browser, 'skipped');
  assert.strictEqual(delivery.inApp.length, 1);
  assert.strictEqual(N.state.shown.length, 0);
});

test('[revoke] a permission that goes default, granted, denied, granted is followed each time', async () => {
  const N = fakeNotification('default', { answer: 'granted' });
  const store = memoryStorage();
  const states = [];
  const snapshot = () => states.push(NP.getPlan(NP.loadPrefs(store), NP.getPermission(N)).state);

  snapshot();                                   // off (nothing chosen)
  await NP.enableBrowserNotifications(N, store);
  snapshot();                                   // active
  N.permission = 'denied'; snapshot();          // blocked
  N.permission = 'default'; snapshot();         // needs-permission
  N.permission = 'granted'; snapshot();         // active again, no new choice needed
  NP.disableBrowserNotifications(N, store);
  snapshot();                                   // off

  assert.deepStrictEqual(states, ['off', 'active', 'blocked', 'needs-permission', 'active', 'off']);
});

test('[revoke] the "show medicine names" choice can be changed and reverted', async () => {
  const N = fakeNotification('granted');
  const store = memoryStorage();
  await NP.enableBrowserNotifications(N, store);

  NP.setShowDetails(N, store, true);
  assert.strictEqual(NP.loadPrefs(store).showDetails, true);
  assert.match(NP.deliver([reminder()], N, NP.loadPrefs(store)).plan.message, /show medicine names/);

  NP.setShowDetails(N, store, false);
  assert.strictEqual(NP.loadPrefs(store).showDetails, false);
  assert.strictEqual(NP.loadPrefs(store).browser, true, 'changing the detail level keeps notifications on');
  NP.setShowDetails(N, store, 'yes');
  assert.strictEqual(NP.loadPrefs(store).showDetails, false, 'only a real true turns it on');
});

// ---------------------------------------------------------------------------
// What a notification says
// ---------------------------------------------------------------------------

const SENSITIVE = [
  reminder({ medicine: 'Metformin 500mg', instructions: 'for diabetes' }),
  reminder({ id: 'r2', medicine: 'Sertraline', time: '21:00', instructions: 'anxiety, with dinner' }),
  reminder({ id: 'r3', medicine: 'HIV PrEP', time: '09:30', instructions: '' })
];

test('[content] by default a notification says only that a reminder is due', () => {
  const one = NP.buildNotificationContent([SENSITIVE[0]], { browser: true });
  assert.strictEqual(one.title, 'RELIEF reminder');
  assert.strictEqual(one.body, 'You have a reminder due. Open RELIEF to see it.');
  const many = NP.buildNotificationContent(SENSITIVE, { browser: true });
  assert.strictEqual(many.body, 'You have 3 reminders due. Open RELIEF to see them.');
});

test('[content] by default nothing sensitive reaches the notification', () => {
  const content = NP.buildNotificationContent(SENSITIVE, { browser: true, showDetails: false });
  const text = content.title + ' ' + content.body;
  SENSITIVE.forEach((r) => {
    assert.ok(!text.includes(r.medicine), 'medicine name leaked: ' + r.medicine);
    assert.ok(!text.includes(r.time), 'time leaked');
    if (r.instructions) assert.ok(!text.includes(r.instructions), 'note leaked');
  });
});

test('[content] with the opt-in, names and times are shown, but notes never are', () => {
  const one = NP.buildNotificationContent([SENSITIVE[0]], { browser: true, showDetails: true });
  assert.strictEqual(one.body, 'Reminder: Metformin 500mg (08:00)');
  const many = NP.buildNotificationContent(SENSITIVE, { browser: true, showDetails: true });
  assert.match(many.body, /Metformin 500mg \(08:00\), Sertraline \(21:00\), HIV PrEP \(09:30\)/);
  SENSITIVE.forEach((r) => {
    if (r.instructions) assert.ok(!(one.body + many.body).includes(r.instructions), 'a note reached the notification');
  });
});

test('[content] several due reminders share one tag, so they replace each other instead of piling up', () => {
  const a = NP.buildNotificationContent([SENSITIVE[0]], {});
  const b = NP.buildNotificationContent(SENSITIVE, {});
  assert.strictEqual(a.tag, b.tag);
  assert.strictEqual(a.tag, NP.NOTIFICATION_TAG);
});

test('[content] odd input does not throw', () => {
  assert.doesNotThrow(() => NP.buildNotificationContent(null, null));
  assert.doesNotThrow(() => NP.buildNotificationContent([], { showDetails: true }));
  assert.strictEqual(NP.buildNotificationContent([], { showDetails: true }).body, 'You have 0 reminders due. Open RELIEF to see them.');
});

test('[content] the page itself still shows the full reminder, including the note', () => {
  assert.strictEqual(
    NP.buildInAppMessage(SENSITIVE[0]),
    'Reminder: Metformin 500mg (set for 08:00). Note: for diabetes'
  );
  assert.strictEqual(NP.buildInAppMessage(SENSITIVE[2]), 'Reminder: HIV PrEP (set for 09:30).');
});

// ---------------------------------------------------------------------------
// Delivery: preferences are respected consistently, failures fall back
// ---------------------------------------------------------------------------

test('[deliver] an active setting sends one generic notification for several due reminders', () => {
  const N = fakeNotification('granted');
  const result = NP.deliver(SENSITIVE, N, { browser: true, showDetails: false });
  assert.strictEqual(result.browser, 'sent');
  assert.strictEqual(N.state.shown.length, 1, 'one notification, not one per reminder');
  assert.strictEqual(N.state.shown[0].body, 'You have 3 reminders due. Open RELIEF to see them.');
  assert.strictEqual(result.inApp.length, 3, 'the page lists each one');
});

test('[deliver] a notification that cannot be created falls back to the page without throwing', () => {
  const N = fakeNotification('granted', { constructorThrows: true });
  let result;
  assert.doesNotThrow(() => { result = NP.deliver([reminder()], N, { browser: true }); });
  assert.strictEqual(result.browser, 'failed');
  assert.strictEqual(result.inApp.length, 1);
});

test('[deliver] nothing is sent when nothing is due, when the choice is off, or when the browser lacks support', () => {
  const N = fakeNotification('granted');
  assert.strictEqual(NP.deliver([], N, { browser: true }).browser, 'skipped');
  assert.strictEqual(NP.deliver([reminder()], N, { browser: false }).browser, 'skipped');
  assert.strictEqual(NP.deliver([reminder()], undefined, { browser: true }).browser, 'skipped');
  assert.strictEqual(NP.deliver([reminder()], {}, { browser: true }).browser, 'skipped');
  assert.strictEqual(NP.deliver(null, N, { browser: true }).inApp.length, 0);
  assert.strictEqual(N.state.shown.length, 0);
});

test('[deliver] managing reminders works whatever the permission is', () => {
  ['default', 'granted', 'denied'].forEach((permission) => {
    const N = fakeNotification(permission);
    [{ browser: false }, { browser: true }].forEach((prefs) => {
      const result = NP.deliver([reminder()], N, prefs);
      assert.strictEqual(result.inApp.length, 1, permission + ' / ' + JSON.stringify(prefs));
    });
  });
});

test('[deliver] permission state does not leak between scenarios', () => {
  const first = fakeNotification('granted');
  const second = fakeNotification('denied');
  assert.strictEqual(NP.deliver([reminder()], first, { browser: true }).browser, 'sent');
  assert.strictEqual(NP.deliver([reminder()], second, { browser: true }).browser, 'skipped');
  assert.strictEqual(first.state.shown.length, 1);
  assert.strictEqual(second.state.shown.length, 0);
});

// ---------------------------------------------------------------------------
// Wording, page, privacy list
// ---------------------------------------------------------------------------

test('[wording] the explanation covers permission, the lock screen and the always-on page reminders', () => {
  assert.match(NP.EXPLANATION, /browser will ask for permission/);
  assert.match(NP.EXPLANATION, /locked screen/);
  assert.match(NP.EXPLANATION, /always appear on this page/);
  assert.match(NP.DETAILS_WARNING, /can be read by anyone who can see your screen/);
  assert.ok(!/\b(dose|dosage|mg)\b/i.test(NP.EXPLANATION + NP.DETAILS_WARNING), 'no dosage language');
});

test('[page] the dashboard explains first and offers turn on, turn off and the detail choice', () => {
  const html = read('pages', 'dashboard.html');
  assert.match(html, /id="notify-explain"/);
  assert.match(html, /id="notify-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="notify-enable"/);
  assert.match(html, /id="notify-disable"/);
  assert.match(html, /<input type="checkbox" id="notify-details">/);
  assert.match(html, /role="group" aria-labelledby="notify-heading"/);
  const prefsAt = html.indexOf('notification-prefs.js');
  assert.ok(prefsAt !== -1 && prefsAt < html.indexOf('assets/js/dashboard.js'), 'loaded before dashboard.js');
});

test('[page] the dashboard never calls the notification APIs directly', () => {
  const js = read('assets', 'js', 'dashboard.js');
  assert.ok(!/new Notification\(/.test(js), 'delivery goes through NP.deliver');
  assert.ok(!/\.requestPermission\(/.test(js), 'asking goes through NP.enableBrowserNotifications');
  assert.match(js, /NP\.deliver\(/);
  assert.match(js, /NP\.enableBrowserNotifications\(/);
  assert.match(js, /NP\.disableBrowserNotifications\(/);
});

test('[page] nothing asks for permission when the page loads', () => {
  const js = read('assets', 'js', 'dashboard.js');
  const firstEnable = js.indexOf('NP.enableBrowserNotifications(');
  const click = js.lastIndexOf("notifyBtn?.addEventListener('click'", firstEnable);
  assert.ok(click !== -1 && firstEnable - click < 200, 'asking happens only inside the button click handler');
});

test('[privacy] the saved choices are listed in the data inventory and the docs', () => {
  assert.match(read('assets', 'js', 'privacy-data.js'), /relief_notification_prefs_v1/);
  assert.match(read('docs', 'PRIVACY_AND_DATA.md'), /`relief_notification_prefs_v1`/);
});

test('[docs] the rules are written down', () => {
  const doc = read('docs', 'REMINDER_NOTIFICATIONS.md');
  ['permission', 'locked screen', 'turn off', 'blocked', 'unsupported', 'notes'].forEach((term) => {
    assert.ok(doc.toLowerCase().includes(term), 'REMINDER_NOTIFICATIONS.md should cover: ' + term);
  });
});
