/**
 * Time-zone-safe reminder scheduling (Issue #64).
 *
 * Covers: which clock a reminder follows, daylight saving gaps and repeats, travelling,
 * fixed zones, start/end date boundaries, reminders saved for a time that already passed,
 * and migration of reminders saved before schedule modes existed.
 *
 * Dates are chosen from the real 2026 time-zone rules. node --test tests/reminder-timezone.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../assets/js/reminders.js');

const ROOT = path.join(__dirname, '..');
const HOUR = 60 * 60 * 1000;
const at = (iso) => new Date(iso);

let counter = 0;
const idFn = () => 'tz-' + (++counter);

/** Saves a reminder as if it was created at `created` while the device was in `zone`. */
function create(zone, created, input) {
  const res = R.addReminder([], Object.assign({ medicine: 'Vitamin D', time: '08:00' }, input), {
    timeZone: zone, now: at(created), idFn
  });
  assert.ok(res.ok, JSON.stringify(res.errors));
  return res.reminders[0];
}

const due = (list, iso, deviceZone) => R.getDueReminders(list, at(iso), deviceZone).length;

// ---------------------------------------------------------------------------
// Rules: which clock does a reminder follow?
// ---------------------------------------------------------------------------

test('[rules] by default a reminder follows the device clock', () => {
  const r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', {});
  assert.strictEqual(r.scheduleMode, 'local');
  assert.strictEqual(r.timeZone, 'Asia/Kolkata', 'the zone it was created in is kept for reference');
  assert.strictEqual(R.getEffectiveTimeZone(r, 'Europe/London'), 'Europe/London', 'it follows wherever the device is now');
});

test('[rules] a fixed reminder stays in its own zone wherever the device is', () => {
  const r = create('America/Los_Angeles', '2026-10-23T18:30:00Z', { scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' });
  assert.strictEqual(r.scheduleMode, 'fixed');
  assert.strictEqual(r.timeZone, 'Asia/Kolkata');
  assert.strictEqual(R.getEffectiveTimeZone(r, 'America/Los_Angeles'), 'Asia/Kolkata');
  assert.strictEqual(R.getEffectiveTimeZone(r, 'Europe/London'), 'Asia/Kolkata');
});

test('[rules] an unknown zone name falls back to the device zone instead of throwing', () => {
  const broken = { time: '08:00', scheduleMode: 'fixed', timeZone: 'Mars/Phobos', status: 'active' };
  assert.strictEqual(R.getEffectiveTimeZone(broken, 'Asia/Kolkata'), 'Asia/Kolkata');
  assert.doesNotThrow(() => R.getReminderState(broken, at('2026-10-24T04:30:00Z'), 'Asia/Kolkata'));
  assert.doesNotThrow(() => R.getDueReminders([broken], at('2026-10-24T04:30:00Z'), 'Not/AZone'));
});

test('[rules] zone names are checked against the runtime', () => {
  ['Asia/Kolkata', 'UTC', 'America/New_York', 'Pacific/Chatham'].forEach((z) => assert.strictEqual(R.isValidTimeZone(z), true, z));
  ['', '  ', 'Mars/Phobos', 'Not/AZone', 'Kolkata', null, undefined, 5, {}].forEach((z) => assert.strictEqual(R.isValidTimeZone(z), false, String(z)));
});

test('[rules] the schedule mode and zone are validated', () => {
  const ctx = { today: '2026-10-24', timeZone: 'Asia/Kolkata' };
  const check = (extra) => R.validateReminderInput(Object.assign({ medicine: 'Vitamin D', time: '08:00' }, extra), ctx);

  assert.strictEqual(check({}).valid, true);
  assert.strictEqual(check({}).value.scheduleMode, 'local');
  assert.strictEqual(check({ scheduleMode: 'local' }).valid, true);
  assert.strictEqual(check({ scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Dhaka' }).valid, true);
  assert.ok(check({ scheduleMode: 'fixed' }).errors.scheduleTimeZone, 'fixed needs a zone');
  assert.ok(check({ scheduleMode: 'fixed', scheduleTimeZone: 'Mars/Phobos' }).errors.scheduleTimeZone);
  assert.ok(check({ scheduleMode: 'whenever' }).errors.scheduleMode);
  assert.strictEqual(check({ scheduleMode: 'local', scheduleTimeZone: 'Asia/Dhaka' }).value.scheduleTimeZone, '', 'a zone is ignored in local mode');
});

// ---------------------------------------------------------------------------
// Daylight saving
// ---------------------------------------------------------------------------

test('[dst] spring forward: a time that does not exist fires right after the gap, once', () => {
  // New York 2026-03-08: 02:00 EST jumps to 03:00 EDT, so 02:30 never happens.
  const r = create('America/New_York', '2026-03-08T04:00:00Z', { time: '02:30' }); // 23:00 on the 7th
  assert.strictEqual(due([r], '2026-03-08T06:59:00Z', 'America/New_York'), 0, '01:59 EST');
  assert.strictEqual(due([r], '2026-03-08T07:00:00Z', 'America/New_York'), 1, '03:00 EDT, first moment after the gap');

  const fired = R.markNotified([r], r.id, '2026-03-08', at('2026-03-08T07:00:00Z').getTime());
  assert.strictEqual(due(fired, '2026-03-08T07:01:00Z', 'America/New_York'), 0);
  assert.strictEqual(due(fired, '2026-03-08T20:00:00Z', 'America/New_York'), 0, 'not again later the same day');
  assert.strictEqual(due(fired, '2026-03-09T06:30:00Z', 'America/New_York'), 1, 'back to 02:30 the next day (EDT)');
});

test('[dst] fall back: a time that happens twice fires once', () => {
  // New York 2026-11-01: 02:00 EDT falls back to 01:00 EST, so 01:30 happens twice.
  const r = create('America/New_York', '2026-11-01T03:00:00Z', { time: '01:30' }); // 23:00 on 31 Oct
  assert.strictEqual(due([r], '2026-11-01T05:29:00Z', 'America/New_York'), 0);
  assert.strictEqual(due([r], '2026-11-01T05:30:00Z', 'America/New_York'), 1, '01:30 EDT');

  const fired = R.markNotified([r], r.id, '2026-11-01', at('2026-11-01T05:30:00Z').getTime());
  assert.strictEqual(due(fired, '2026-11-01T06:30:00Z', 'America/New_York'), 0, 'the second 01:30 (EST) does not fire again');
  assert.strictEqual(due(fired, '2026-11-02T06:30:00Z', 'America/New_York'), 1, 'next day at 01:30 EST');
});

test('[dst] fall back: even without a recorded firing, a reminder due in the repeated hour fires once', () => {
  const r = create('America/New_York', '2026-11-01T03:00:00Z', { time: '01:30' });
  // First pass of 01:30 missed (tab closed), tab opened during the second 01:30.
  assert.strictEqual(due([r], '2026-11-01T06:30:00Z', 'America/New_York'), 1);
});

test('[dst] London spring forward (01:00 to 02:00) and a reminder at 01:30', () => {
  const r = create('Europe/London', '2026-03-28T22:00:00Z', { time: '01:30' });
  assert.strictEqual(due([r], '2026-03-29T00:59:00Z', 'Europe/London'), 0, '00:59 GMT');
  assert.strictEqual(due([r], '2026-03-29T01:00:00Z', 'Europe/London'), 1, '02:00 BST');
});

test('[dst] a half-hour change (Lord Howe, 02:00 to 02:30) and a reminder at 02:15', () => {
  const r = create('Australia/Lord_Howe', '2026-10-03T12:00:00Z', { time: '02:15' });
  assert.strictEqual(due([r], '2026-10-03T15:29:00Z', 'Australia/Lord_Howe'), 0, '01:59');
  assert.strictEqual(due([r], '2026-10-03T15:30:00Z', 'Australia/Lord_Howe'), 1, '02:30');
});

test('[dst] a 45-minute offset zone (Chatham) keeps its normal time', () => {
  const r = create('Pacific/Chatham', '2026-06-20T04:00:00Z', { time: '08:00' });
  // Chatham is UTC+12:45 in winter: 08:00 is 19:15Z the day before.
  assert.strictEqual(due([r], '2026-06-20T19:14:00Z', 'Pacific/Chatham'), 0);
  assert.strictEqual(due([r], '2026-06-20T19:15:00Z', 'Pacific/Chatham'), 1);
});

test('[dst] across every 2026 clock change, a reminder fires exactly once per local day', () => {
  const windows = [
    ['America/New_York', '2026-03-06', '2026-03-11'],
    ['America/New_York', '2026-10-30', '2026-11-04'],
    ['Europe/London', '2026-03-27', '2026-04-01'],
    ['Europe/London', '2026-10-23', '2026-10-28'],
    ['Australia/Sydney', '2026-04-03', '2026-04-08'],
    ['Australia/Sydney', '2026-10-02', '2026-10-07'],
    ['Australia/Lord_Howe', '2026-04-03', '2026-04-08'],
    ['Australia/Lord_Howe', '2026-10-02', '2026-10-07'],
    ['Pacific/Chatham', '2026-04-03', '2026-04-08'],
    ['Pacific/Chatham', '2026-09-25', '2026-09-30'],
    ['Asia/Kolkata', '2026-10-22', '2026-10-27']
  ];
  // The loop checks every 15 minutes, so times sit on quarter hours (the dashboard itself checks every 30 seconds).
  const times = ['00:00', '00:30', '01:30', '02:00', '02:15', '02:30', '03:00', '12:00', '23:45'];

  windows.forEach(([zone, from, to]) => {
    let list = times.map((time, i) => Object.assign(
      create(zone, from + 'T00:00:00Z', { time, medicine: 'Med ' + i }),
      { lastNotifiedOn: '', lastNotifiedAtMs: 0 }
    ));
    const firedOn = {};
    const startMs = Date.parse(from + 'T12:00:00Z');
    const endMs = Date.parse(to + 'T12:00:00Z');
    for (let t = startMs; t < endMs; t += 15 * 60 * 1000) {
      const now = new Date(t);
      R.getDueReminders(list, now, zone).forEach((r) => {
        const date = R.getLocalParts(now, zone).date;
        const key = r.time + ' on ' + date;
        firedOn[key] = (firedOn[key] || 0) + 1;
        list = R.markNotified(list, r.id, date, t);
      });
    }
    Object.keys(firedOn).forEach((key) => assert.strictEqual(firedOn[key], 1, zone + ' ' + from + ': ' + key + ' fired ' + firedOn[key] + ' times'));

    // Every reminder fired on each full local day inside the window.
    const days = {};
    Object.keys(firedOn).forEach((key) => { days[key.split(' on ')[1]] = true; });
    assert.ok(Object.keys(days).length >= 4, zone + ' ' + from + ' should cover at least 4 local days');
    times.forEach((time) => {
      Object.keys(days).slice(1, -1).forEach((date) => {
        assert.strictEqual(firedOn[time + ' on ' + date], 1, zone + ': ' + time + ' missed on ' + date);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Travelling and changed device settings
// ---------------------------------------------------------------------------

test('[travel] flying east to west the same day does not repeat a reminder that already fired', () => {
  const r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { time: '08:00' });
  const fired = R.markNotified([r], r.id, '2026-10-24', at('2026-10-24T02:30:00Z').getTime());
  // Kolkata 08:00 on the 24th is 19:30 on the 23rd in Los Angeles, then LA 08:00 on the 24th comes later.
  assert.strictEqual(due(fired, '2026-10-24T15:00:00Z', 'America/Los_Angeles'), 0, '08:00 PDT on the 24th, same date');
});

test('[travel] moving west across the date line does not fire the same reminder twice within 6 hours', () => {
  // Fired in Auckland at 08:00 on 28 Oct (NZDT). Three hours later the device is in Los Angeles,
  // where it is still 27 Oct and 15:00: without the guard the date check alone would fire it again.
  const r = create('Pacific/Auckland', '2026-10-27T10:00:00Z', { time: '08:00' });
  const firedAt = at('2026-10-27T19:00:00Z').getTime(); // 08:00 on 28 Oct NZDT
  const fired = R.markNotified([r], r.id, '2026-10-28', firedAt);

  assert.strictEqual(due(fired, '2026-10-27T22:00:00Z', 'America/Los_Angeles'), 0, '3 hours after it fired');
  assert.strictEqual(due(fired, '2026-10-28T00:59:00Z', 'America/Los_Angeles'), 0, 'just under 6 hours');
  assert.strictEqual(due(fired, '2026-10-28T01:01:00Z', 'America/Los_Angeles'), 1, 'after 6 hours it is a new local day for this reminder');
});

test('[travel] the guard only covers a few hours; normal daily reminders are not held back', () => {
  const r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { time: '08:00' });
  const fired = R.markNotified([r], r.id, '2026-10-24', at('2026-10-24T02:30:00Z').getTime());
  assert.strictEqual(due(fired, '2026-10-25T02:30:00Z', 'Asia/Kolkata'), 1, '24 hours later');
  assert.ok(R.MIN_GAP_MS >= 3 * HOUR && R.MIN_GAP_MS <= 12 * HOUR);
});

test('[travel] a device clock moved back does not silence a reminder', () => {
  const r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { time: '08:00' });
  // It "fired" at an instant that is now in the future (the clock was set back by a day).
  const fired = R.markNotified([r], r.id, '2026-10-25', at('2026-10-25T02:30:00Z').getTime());
  assert.strictEqual(due(fired, '2026-10-24T05:00:00Z', 'Asia/Kolkata'), 1, 'a repeat is safer than a missed reminder');
});

test('[travel] changing the device zone mid-day moves a local reminder with the device', () => {
  const r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { time: '20:00' });
  const instant = '2026-10-24T14:00:00Z'; // 19:30 Kolkata, 07:00 Los Angeles, 15:00 London
  assert.strictEqual(due([r], instant, 'Asia/Kolkata'), 0);
  assert.strictEqual(due([r], '2026-10-24T14:30:00Z', 'Asia/Kolkata'), 1, '20:00 Kolkata');
  assert.strictEqual(due([r], '2026-10-24T14:30:00Z', 'America/Los_Angeles'), 0, '07:30 in Los Angeles');
  assert.strictEqual(due([r], '2026-10-25T03:00:00Z', 'America/Los_Angeles'), 1, '20:00 in Los Angeles');
});

test('[fixed] a fixed reminder fires on its own clock wherever the device is', () => {
  const r = create('America/Los_Angeles', '2026-10-23T12:00:00Z', { scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' });
  assert.strictEqual(r.time, '08:00');
  // 08:00 in Kolkata is 02:30Z. On a device in Los Angeles that is 19:30 the day before.
  assert.strictEqual(due([r], '2026-10-24T02:29:00Z', 'America/Los_Angeles'), 0);
  assert.strictEqual(due([r], '2026-10-24T02:30:00Z', 'America/Los_Angeles'), 1);
  assert.strictEqual(due([r], '2026-10-24T02:30:00Z', 'Europe/London'), 1);
  assert.strictEqual(due([r], '2026-10-24T15:00:00Z', 'America/Los_Angeles'), 1, 'still due later the same Kolkata day');
});

test('[fixed] the date used to stop a fired reminder from repeating is the fixed zone\'s date', () => {
  const r = create('America/Los_Angeles', '2026-10-23T12:00:00Z', { scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' });
  const when = at('2026-10-24T02:30:00Z');
  const date = R.getLocalParts(when, R.getEffectiveTimeZone(r, 'America/Los_Angeles')).date;
  assert.strictEqual(date, '2026-10-24', 'Kolkata date, although it is still 23 Oct in Los Angeles');
  const fired = R.markNotified([r], r.id, date, when.getTime());
  assert.strictEqual(due(fired, '2026-10-24T20:00:00Z', 'America/Los_Angeles'), 0);
  assert.strictEqual(due(fired, '2026-10-25T02:30:00Z', 'America/Los_Angeles'), 1);
});

test('[fixed] a fixed zone with daylight saving follows that zone\'s clock change', () => {
  // 08:00 in New York is 13:00Z in winter (EST) and 12:00Z after the change on 2026-03-08 (EDT).
  const r = create('Asia/Kolkata', '2026-03-06T12:00:00Z', { time: '08:00', scheduleMode: 'fixed', scheduleTimeZone: 'America/New_York' });
  assert.strictEqual(due([r], '2026-03-07T12:59:00Z', 'Asia/Kolkata'), 0, '07:59 EST');
  assert.strictEqual(due([r], '2026-03-07T13:00:00Z', 'Asia/Kolkata'), 1, '08:00 EST');

  const fired = R.markNotified([r], r.id, '2026-03-07', at('2026-03-07T13:00:00Z').getTime());
  assert.strictEqual(due(fired, '2026-03-08T11:59:00Z', 'Asia/Kolkata'), 0, '07:59 EDT');
  assert.strictEqual(due(fired, '2026-03-08T12:00:00Z', 'Asia/Kolkata'), 1, '08:00 EDT: one hour earlier in UTC');
});

// ---------------------------------------------------------------------------
// Start and end dates
// ---------------------------------------------------------------------------

test('[dates] start and end dates are read in the zone the reminder runs in', () => {
  const local = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { startDate: '2026-10-25', endDate: '2026-10-26' });
  const state = (r, iso, zone) => R.getReminderState(r, at(iso), zone);

  assert.strictEqual(state(local, '2026-10-24T18:29:00Z', 'Asia/Kolkata'), 'upcoming', '23:59 on the 24th');
  assert.strictEqual(state(local, '2026-10-24T18:30:00Z', 'Asia/Kolkata'), 'active', '00:00 on the 25th');
  assert.strictEqual(state(local, '2026-10-26T18:29:00Z', 'Asia/Kolkata'), 'active', '23:59 on the 26th');
  assert.strictEqual(state(local, '2026-10-26T18:30:00Z', 'Asia/Kolkata'), 'expired', '00:00 on the 27th');

  // The same instants in Los Angeles are still the previous day for a local reminder.
  assert.strictEqual(state(local, '2026-10-24T18:30:00Z', 'America/Los_Angeles'), 'upcoming');
  assert.strictEqual(state(local, '2026-10-26T18:30:00Z', 'America/Los_Angeles'), 'active');
});

test('[dates] a fixed reminder\'s dates do not move when the device does', () => {
  const r = create('America/Los_Angeles', '2026-10-23T12:00:00Z', {
    scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata', startDate: '2026-10-25', endDate: '2026-10-26'
  });
  assert.strictEqual(R.getReminderState(r, at('2026-10-24T18:30:00Z'), 'America/Los_Angeles'), 'active', '00:00 on 25 Oct in Kolkata');
  assert.strictEqual(R.getReminderState(r, at('2026-10-26T18:30:00Z'), 'America/Los_Angeles'), 'expired');
});

test('[dates] an end date is judged on the schedule\'s own "today" when saving', () => {
  const now = at('2026-10-24T18:40:00Z'); // 00:10 on the 25th in Kolkata, 11:40 on the 24th in Los Angeles
  const input = { medicine: 'Vitamin D', time: '08:00', endDate: '2026-10-24' };
  const asLocalLA = R.validateReminderInput(input, { now, timeZone: 'America/Los_Angeles' });
  assert.strictEqual(asLocalLA.errors.endDate, undefined, 'still the 24th for a Los Angeles device');
  const asFixedKolkata = R.validateReminderInput(Object.assign({ scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' }, input), { now, timeZone: 'America/Los_Angeles' });
  assert.match(asFixedKolkata.errors.endDate, /already passed/);
});

test('[dates] ordering rules still hold: end before start, impossible dates', () => {
  const ctx = { today: '2026-10-24', timeZone: 'Asia/Kolkata' };
  const check = (extra) => R.validateReminderInput(Object.assign({ medicine: 'Vitamin D', time: '08:00' }, extra), ctx);
  assert.match(check({ startDate: '2026-11-10', endDate: '2026-11-01' }).errors.endDate, /before the start/);
  assert.ok(check({ startDate: '2026-02-30' }).errors.startDate);
  assert.ok(check({ endDate: '2026-02-30' }).errors.endDate);
  assert.strictEqual(check({ startDate: '2020-01-01' }).valid, true, 'a start date in the past is allowed (already running)');
  assert.strictEqual(check({ endDate: '2026-10-24' }).valid, true, 'ending today is allowed');
});

// ---------------------------------------------------------------------------
// A reminder saved for a time that already passed today
// ---------------------------------------------------------------------------

test('[first-run] saving a reminder for a time that already passed waits until tomorrow', () => {
  const r = create('Asia/Kolkata', '2026-10-24T04:30:00Z', { time: '08:00' }); // it is 10:00
  assert.strictEqual(r.lastNotifiedOn, '2026-10-24');
  assert.strictEqual(due([r], '2026-10-24T04:31:00Z', 'Asia/Kolkata'), 0, 'not immediately');
  assert.strictEqual(due([r], '2026-10-24T14:00:00Z', 'Asia/Kolkata'), 0, 'not later today');
  assert.strictEqual(due([r], '2026-10-25T02:30:00Z', 'Asia/Kolkata'), 1, 'tomorrow at 08:00');
});

test('[first-run] a time later today still fires today', () => {
  const r = create('Asia/Kolkata', '2026-10-24T04:30:00Z', { time: '11:00' }); // it is 10:00
  assert.strictEqual(r.lastNotifiedOn, '');
  assert.strictEqual(due([r], '2026-10-24T05:29:00Z', 'Asia/Kolkata'), 0);
  assert.strictEqual(due([r], '2026-10-24T05:30:00Z', 'Asia/Kolkata'), 1);
});

test('[first-run] the exact current minute counts as now', () => {
  const r = create('Asia/Kolkata', '2026-10-24T04:30:00Z', { time: '10:00' });
  assert.strictEqual(due([r], '2026-10-24T04:30:00Z', 'Asia/Kolkata'), 1);
});

test('[first-run] a start date in the future is not marked as handled', () => {
  const r = create('Asia/Kolkata', '2026-10-24T04:30:00Z', { time: '08:00', startDate: '2026-10-26' });
  assert.strictEqual(r.lastNotifiedOn, '');
  assert.strictEqual(due([r], '2026-10-26T02:30:00Z', 'Asia/Kolkata'), 1, 'fires on its first day');
});

test('[first-run] a fixed reminder uses the fixed zone\'s clock to decide', () => {
  // 10:00 in Kolkata is still 21:30 the day before in Los Angeles; 08:00 Kolkata has passed.
  const r = create('America/Los_Angeles', '2026-10-24T04:30:00Z', { time: '08:00', scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' });
  assert.strictEqual(r.lastNotifiedOn, '2026-10-24');
  assert.strictEqual(due([r], '2026-10-24T14:00:00Z', 'America/Los_Angeles'), 0);
  assert.strictEqual(due([r], '2026-10-25T02:30:00Z', 'America/Los_Angeles'), 1);
});

test('[first-run] editing the time to one that has passed also waits; changing only the note changes nothing', () => {
  let r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { time: '11:00' });
  const ctx = { timeZone: 'Asia/Kolkata', now: at('2026-10-24T04:30:00Z'), idFn };
  const moved = R.editReminder([r], r.id, { medicine: 'Vitamin D', time: '07:00' }, ctx);
  assert.strictEqual(moved.reminder.lastNotifiedOn, '2026-10-24');

  const noted = R.editReminder([r], r.id, { medicine: 'Vitamin D', time: '11:00', instructions: 'with water' }, ctx);
  assert.strictEqual(noted.reminder.lastNotifiedOn, r.lastNotifiedOn);

  r = R.markNotified([r], r.id, '2026-10-24', at('2026-10-24T05:30:00Z').getTime())[0];
  const same = R.editReminder([r], r.id, { medicine: 'Vitamin D', time: '11:00', instructions: 'x' }, ctx);
  assert.strictEqual(same.reminder.lastNotifiedOn, '2026-10-24', 'a reminder that fired today does not fire again after a note edit');
  assert.ok(same.reminder.lastNotifiedAtMs > 0);
});

test('[first-run] switching a reminder from local to fixed restarts its schedule', () => {
  const r = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { time: '08:00' });
  const ctx = { timeZone: 'Asia/Kolkata', now: at('2026-10-24T01:00:00Z'), idFn }; // 06:30 in Kolkata
  const res = R.editReminder([r], r.id, { medicine: 'Vitamin D', time: '08:00', scheduleMode: 'fixed', scheduleTimeZone: 'Europe/London' }, ctx);
  assert.ok(res.ok);
  assert.strictEqual(res.reminder.scheduleMode, 'fixed');
  assert.strictEqual(res.reminder.timeZone, 'Europe/London');
  assert.strictEqual(res.reminder.lastNotifiedAtMs, 0);
});

// ---------------------------------------------------------------------------
// Explaining the behaviour before saving
// ---------------------------------------------------------------------------

test('[explain] local mode says it follows the device clock, what travel does and what DST does', () => {
  const text = R.explainSchedule({ time: '08:00' }, at('2026-10-24T01:00:00Z'), 'Asia/Kolkata');
  assert.match(text, /Every day at 08:00 on this device's clock \(Asia\/Kolkata\)/);
  assert.match(text, /travel or change the device time zone, it follows the new local time/);
  assert.match(text, /daylight saving skips this time, it appears right after/);
  assert.match(text, /First reminder: today at 08:00\./);
});

test('[explain] the first reminder is today, tomorrow or on the start date', () => {
  const now = at('2026-10-24T04:30:00Z'); // 10:00 Kolkata
  assert.match(R.explainSchedule({ time: '11:00' }, now, 'Asia/Kolkata'), /First reminder: today at 11:00\./);
  assert.match(R.explainSchedule({ time: '08:00' }, now, 'Asia/Kolkata'), /First reminder: tomorrow at 08:00\./);
  assert.match(R.explainSchedule({ time: '08:00', startDate: '2026-11-02' }, now, 'Asia/Kolkata'), /First reminder: on 2026-11-02\./);
  assert.match(R.explainSchedule({ time: '08:00', startDate: '2020-01-01' }, now, 'Asia/Kolkata'), /tomorrow at 08:00/);
});

test('[explain] fixed mode shows both clocks so the effect of travelling is clear', () => {
  const text = R.explainSchedule(
    { time: '08:00', scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' },
    at('2026-10-24T10:00:00Z'), 'America/Los_Angeles'
  );
  assert.match(text, /Every day at 08:00 in Asia\/Kolkata/);
  assert.match(text, /That is 19:30 on this device now \(America\/Los_Angeles\)/);
  assert.match(text, /stays on that time zone if you travel/);
});

test('[explain] nothing is said until there is something to say', () => {
  assert.strictEqual(R.explainSchedule({}, new Date(), 'Asia/Kolkata'), '');
  assert.strictEqual(R.explainSchedule({ time: '25:00' }, new Date(), 'Asia/Kolkata'), '');
  assert.match(R.explainSchedule({ time: '08:00', scheduleMode: 'fixed', scheduleTimeZone: '' }, new Date(), 'Asia/Kolkata'), /Choose a time zone/);
  assert.strictEqual(R.explainSchedule(null, new Date(), 'Asia/Kolkata'), '');
});

test('[explain] the device-clock equivalent is right across day boundaries', () => {
  const fixed = (time, zone) => ({ time, scheduleMode: 'fixed', timeZone: zone });
  const now = at('2026-10-24T10:00:00Z');
  assert.strictEqual(R.localEquivalent(fixed('08:00', 'Asia/Kolkata'), now, 'America/Los_Angeles'), '19:30');
  assert.strictEqual(R.localEquivalent(fixed('23:30', 'Pacific/Auckland'), now, 'Asia/Kolkata'), '16:00');
  assert.strictEqual(R.localEquivalent(fixed('00:15', 'Asia/Tokyo'), now, 'Europe/London'), '16:15', 'London is on summer time until 25 Oct');
  assert.strictEqual(R.localEquivalent(fixed('08:00', 'Asia/Kolkata'), now, 'Asia/Kolkata'), '08:00');
});

test('[explain] reminders list warns when the device zone differs', () => {
  const local = create('Asia/Kolkata', '2026-10-23T18:30:00Z', {});
  assert.match(R.getTimeZoneWarning(local, 'Europe/London'), /Created in Asia\/Kolkata\. It now follows this device's clock \(Europe\/London\)/);
  assert.strictEqual(R.getTimeZoneWarning(local, 'Asia/Kolkata'), '');
  const fixed = create('Asia/Kolkata', '2026-10-23T18:30:00Z', { scheduleMode: 'fixed', scheduleTimeZone: 'Europe/London' });
  assert.match(R.getTimeZoneWarning(fixed, 'Asia/Kolkata'), /Fixed to Europe\/London\. This device is in Asia\/Kolkata/);
});

test('[explain] no schedule text gives medical dosage advice', () => {
  const samples = [
    R.explainSchedule({ time: '08:00' }, new Date(), 'Asia/Kolkata'),
    R.explainSchedule({ time: '08:00', scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Dhaka' }, new Date(), 'Asia/Kolkata'),
    R.TIMEZONE_NOTE, R.PERSISTENCE_NOTE,
    R.buildReminderMessage({ medicine: 'Vitamin D', time: '08:00', instructions: '' })
  ].join(' ');
  assert.ok(!/\b(dose|dosage|mg|tablet|how much|you should take|recommended)\b/i.test(samples), samples);
  assert.match(R.REMINDER_DISCLAIMER, /does not suggest medicines, doses or schedules/);
});

// ---------------------------------------------------------------------------
// Migration of reminders saved before schedule modes existed
// ---------------------------------------------------------------------------

function storageWith(value) {
  const data = { [R.REMINDERS_KEY]: typeof value === 'string' ? value : JSON.stringify(value) };
  const writes = [];
  return {
    data, writes,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { writes.push(k); data[k] = String(v); }
  };
}

test('[migration] a reminder saved before schedule modes keeps working exactly as before', () => {
  const old = {
    id: 'old-1', medicine: 'Vitamin D', instructions: 'with breakfast', time: '08:00',
    startDate: '2026-10-01', endDate: '2026-12-31', status: 'active', timeZone: 'Asia/Kolkata', lastNotifiedOn: '2026-10-23'
  };
  const [r] = R.loadReminders(storageWith([old]));

  assert.strictEqual(r.scheduleMode, 'local');
  assert.strictEqual(r.lastNotifiedAtMs, 0);
  ['id', 'medicine', 'instructions', 'time', 'startDate', 'endDate', 'status', 'timeZone', 'lastNotifiedOn'].forEach((k) => {
    assert.strictEqual(r[k], old[k], k + ' must be unchanged');
  });
  assert.strictEqual(due([r], '2026-10-24T02:30:00Z', 'Asia/Kolkata'), 1, 'due at the same moment as before');
  assert.strictEqual(due([r], '2026-10-24T02:29:00Z', 'Asia/Kolkata'), 0);
});

test('[migration] oldest entries with only a name and a time are still read', () => {
  const list = R.loadReminders(storageWith([{ medicine: 'Iron', time: '21:00' }, { medicine: 'Zinc', time: '7am' }, 'junk', null]));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].medicine, 'Iron');
  assert.strictEqual(list[0].scheduleMode, 'local');
  assert.strictEqual(list[0].timeZone, '');
});

test('[migration] loading never rewrites the stored data', () => {
  const store = storageWith([{ id: 'a', medicine: 'Iron', time: '21:00' }]);
  const before = store.data[R.REMINDERS_KEY];
  R.loadReminders(store);
  assert.strictEqual(store.writes.length, 0);
  assert.strictEqual(store.data[R.REMINDERS_KEY], before);
});

test('[migration] invalid new fields are repaired, not trusted', () => {
  const list = R.loadReminders(storageWith([
    { id: 'a', medicine: 'A', time: '08:00', scheduleMode: 'fixed', timeZone: 'Mars/Phobos' },
    { id: 'b', medicine: 'B', time: '08:00', scheduleMode: 'fixed' },
    { id: 'c', medicine: 'C', time: '08:00', scheduleMode: 'sometimes', timeZone: 'Asia/Kolkata' },
    { id: 'd', medicine: 'D', time: '08:00', lastNotifiedAtMs: 'yesterday' },
    { id: 'e', medicine: 'E', time: '08:00', lastNotifiedAtMs: -5 },
    { id: 'f', medicine: 'F', time: '08:00', scheduleMode: 'fixed', timeZone: 'Asia/Dhaka', lastNotifiedAtMs: 1700000000000 }
  ]));
  assert.deepStrictEqual(list.map((r) => r.scheduleMode), ['local', 'local', 'local', 'local', 'local', 'fixed']);
  assert.deepStrictEqual(list.map((r) => r.lastNotifiedAtMs), [0, 0, 0, 0, 0, 1700000000000]);
});

test('[migration] saving then loading keeps the new fields', () => {
  const store = storageWith([]);
  const r = create('America/Los_Angeles', '2026-10-23T12:00:00Z', { scheduleMode: 'fixed', scheduleTimeZone: 'Asia/Kolkata' });
  const fired = R.markNotified([r], r.id, '2026-10-24', 1761275400000);
  assert.strictEqual(R.saveReminders(store, fired), true);
  const [back] = R.loadReminders(store);
  assert.strictEqual(back.scheduleMode, 'fixed');
  assert.strictEqual(back.timeZone, 'Asia/Kolkata');
  assert.strictEqual(back.lastNotifiedAtMs, 1761275400000);
  assert.strictEqual(back.lastNotifiedOn, '2026-10-24');
});

test('[migration] corrupt storage gives an empty list, not a crash', () => {
  assert.deepStrictEqual(R.loadReminders(storageWith('{broken')), []);
  assert.deepStrictEqual(R.loadReminders(storageWith('{"not":"a list"}')), []);
});

// ---------------------------------------------------------------------------
// Wiring and documentation
// ---------------------------------------------------------------------------

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('[wiring] the dashboard offers both clocks, explains them, and confirms the first reminder', () => {
  const html = read('pages', 'dashboard.html');
  assert.match(html, /<fieldset[^>]*id="schedule-group"/);
  assert.match(html, /<legend>Which clock should this follow\?<\/legend>/);
  assert.match(html, /id="schedule-local"[^>]*value="local"[^>]*checked/);
  assert.match(html, /id="schedule-fixed"[^>]*value="fixed"/);
  assert.match(html, /<label for="schedule-zone">/);
  assert.match(html, /id="schedule-explain"[^>]*aria-live="polite"/);
  assert.match(html, /id="reminder-saved"[^>]*role="status"/);
});

test('[wiring] the dashboard uses each reminder\'s own zone and records when it fired', () => {
  const js = read('assets', 'js', 'dashboard.js');
  assert.match(js, /R\.getEffectiveTimeZone\(r, timeZone\)/);
  assert.match(js, /R\.markNotified\(reminders, r\.id, date, now\.getTime\(\)\)/);
  assert.match(js, /R\.explainSchedule\(/);
  assert.match(js, /scheduleMode: fields\.modeFixed\.checked \? 'fixed' : 'local'/);
});

test('[docs] the scheduling rules are documented', () => {
  const doc = read('docs', 'REMINDER_SCHEDULING.md');
  ['device clock', 'fixed time zone', 'daylight saving', 'only fire while', 'Migration', 'dosage'].forEach((term) => {
    assert.ok(doc.toLowerCase().includes(term.toLowerCase()), 'REMINDER_SCHEDULING.md should cover: ' + term);
  });
  assert.ok(doc.includes(String(R.MIN_GAP_MS / HOUR) + ' hours'), 'the documented guard time matches the code');
});
