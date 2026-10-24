/**
 * Tests for Issue #19: medicine reminders and persistence.
 * Covers validation, duplicates, edit / pause / complete, migration of old
 * localStorage entries, time zone behaviour and notification fallback wording.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../assets/js/reminders.js');

const TZ = 'Asia/Kolkata';
// 2026-10-24 10:00 in Asia/Kolkata
const NOW = new Date('2026-10-24T04:30:00Z');
const CTX = { now: NOW, timeZone: TZ, idFn: (() => { let n = 0; return () => `id-${++n}`; })() };

function memoryStorage(initial) {
    const data = new Map(Object.entries(initial || {}));
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)); }
    };
}

function base(overrides) {
    return { medicine: 'Vitamin D', instructions: '', time: '08:00', startDate: '', endDate: '', ...overrides };
}

describe('GitHub Issue #19: medicine reminders', () => {

    describe('validation', () => {
        it('accepts a minimal reminder (name + time)', () => {
            const r = R.validateReminderInput(base(), CTX);
            assert.strictEqual(r.valid, true);
        });

        it('requires a medicine name and a time', () => {
            const r = R.validateReminderInput({ medicine: '   ', time: '' }, CTX);
            assert.strictEqual(r.valid, false);
            assert.ok(r.errors.medicine);
            assert.ok(r.errors.time);
        });

        it('rejects malformed times', () => {
            for (const t of ['25:00', '12:60', '8:00', 'abc']) {
                assert.ok(R.validateReminderInput(base({ time: t }), CTX).errors.time, t);
            }
        });

        it('rejects dates that do not exist', () => {
            assert.ok(R.validateReminderInput(base({ startDate: '2026-02-30' }), CTX).errors.startDate);
            assert.ok(R.validateReminderInput(base({ endDate: '2026-13-01' }), CTX).errors.endDate);
            assert.ok(R.validateReminderInput(base({ endDate: 'tomorrow' }), CTX).errors.endDate);
        });

        it('rejects an end date before the start date', () => {
            const r = R.validateReminderInput(base({ startDate: '2026-11-10', endDate: '2026-11-01' }), CTX);
            assert.ok(r.errors.endDate);
        });

        it('rejects an end date that already passed, but allows today', () => {
            assert.ok(R.validateReminderInput(base({ endDate: '2026-10-23' }), CTX).errors.endDate);
            assert.strictEqual(R.validateReminderInput(base({ endDate: '2026-10-24' }), CTX).valid, true);
        });

        it('allows a start date in the past', () => {
            assert.strictEqual(R.validateReminderInput(base({ startDate: '2026-10-01' }), CTX).valid, true);
        });

        it('limits name and note length', () => {
            assert.ok(R.validateReminderInput(base({ medicine: 'x'.repeat(81) }), CTX).errors.medicine);
            assert.ok(R.validateReminderInput(base({ instructions: 'x'.repeat(301) }), CTX).errors.instructions);
        });

        it('trims and collapses whitespace in the name', () => {
            const r = R.validateReminderInput(base({ medicine: '  Vitamin    D ' }), CTX);
            assert.strictEqual(r.value.medicine, 'Vitamin D');
        });
    });

    describe('create and duplicates', () => {
        it('adds a reminder as active with the device time zone', () => {
            const r = R.addReminder([], base(), CTX);
            assert.strictEqual(r.ok, true);
            assert.strictEqual(r.reminders.length, 1);
            assert.strictEqual(r.reminder.status, 'active');
            assert.strictEqual(r.reminder.timeZone, TZ);
        });

        it('does not mutate the list it was given', () => {
            const list = [];
            R.addReminder(list, base(), CTX);
            assert.strictEqual(list.length, 0);
        });

        it('blocks the same medicine at the same time, ignoring case and spacing', () => {
            const first = R.addReminder([], base(), CTX);
            const dup = R.addReminder(first.reminders, base({ medicine: ' vitamin   d ' }), CTX);
            assert.strictEqual(dup.ok, false);
            assert.ok(dup.errors.form);
            assert.strictEqual(dup.reminders.length, 1);
        });

        it('allows the same medicine at a different time', () => {
            const first = R.addReminder([], base(), CTX);
            const second = R.addReminder(first.reminders, base({ time: '20:00' }), CTX);
            assert.strictEqual(second.ok, true);
            assert.strictEqual(second.reminders.length, 2);
        });

        it('does not count a completed reminder as a duplicate', () => {
            const first = R.addReminder([], base(), CTX);
            const done = R.completeReminder(first.reminders, first.reminder.id);
            assert.strictEqual(R.addReminder(done.reminders, base(), CTX).ok, true);
        });

        it('does not count a paused reminder as a free slot', () => {
            const first = R.addReminder([], base(), CTX);
            const paused = R.setPaused(first.reminders, first.reminder.id, true);
            assert.strictEqual(R.addReminder(paused.reminders, base(), CTX).ok, false);
        });
    });

    describe('edit, pause, complete, remove', () => {
        const seed = () => R.addReminder([], base(), { ...CTX, idFn: () => 'a' }).reminders;

        it('edits fields and keeps the id and status', () => {
            const r = R.editReminder(seed(), 'a', base({ medicine: 'Vitamin D3', time: '09:15', instructions: 'with lunch' }), CTX);
            assert.strictEqual(r.ok, true);
            assert.strictEqual(r.reminder.id, 'a');
            assert.strictEqual(r.reminder.medicine, 'Vitamin D3');
            assert.strictEqual(r.reminder.time, '09:15');
            assert.strictEqual(r.reminder.instructions, 'with lunch');
            assert.strictEqual(r.reminder.status, 'active');
        });

        it('re-validates on edit', () => {
            assert.strictEqual(R.editReminder(seed(), 'a', base({ time: 'nope' }), CTX).ok, false);
        });

        it('lets a reminder be saved unchanged (not a duplicate of itself)', () => {
            assert.strictEqual(R.editReminder(seed(), 'a', base(), CTX).ok, true);
        });

        it('blocks an edit that would duplicate another reminder', () => {
            let list = seed();
            list = R.addReminder(list, base({ time: '20:00' }), { ...CTX, idFn: () => 'b' }).reminders;
            const r = R.editReminder(list, 'b', base({ time: '08:00' }), CTX);
            assert.strictEqual(r.ok, false);
        });

        it('clears lastNotifiedOn only when the time changes', () => {
            const list = R.markNotified(seed(), 'a', '2026-10-24');
            assert.strictEqual(R.editReminder(list, 'a', base({ instructions: 'x' }), CTX).reminder.lastNotifiedOn, '2026-10-24');
            assert.strictEqual(R.editReminder(list, 'a', base({ time: '11:00' }), CTX).reminder.lastNotifiedOn, '');
        });

        it('pauses and resumes', () => {
            const paused = R.setPaused(seed(), 'a', true);
            assert.strictEqual(paused.reminder.status, 'paused');
            const resumed = R.setPaused(paused.reminders, 'a', false);
            assert.strictEqual(resumed.reminder.status, 'active');
        });

        it('marks a reminder completed and keeps it in the list', () => {
            const r = R.completeReminder(seed(), 'a');
            assert.strictEqual(r.reminders.length, 1);
            assert.strictEqual(r.reminder.status, 'completed');
        });

        it('does not edit, pause or resume a completed reminder', () => {
            const done = R.completeReminder(seed(), 'a').reminders;
            assert.strictEqual(R.editReminder(done, 'a', base(), CTX).ok, false);
            assert.strictEqual(R.setPaused(done, 'a', true).ok, false);
            assert.strictEqual(R.setPaused(done, 'a', false).ok, false);
        });

        it('removes a reminder', () => {
            assert.strictEqual(R.removeReminder(seed(), 'a').reminders.length, 0);
        });

        it('reports a missing id instead of throwing', () => {
            assert.strictEqual(R.editReminder([], 'zzz', base(), CTX).ok, false);
            assert.strictEqual(R.setPaused([], 'zzz', true).ok, false);
            assert.strictEqual(R.completeReminder([], 'zzz').ok, false);
            assert.strictEqual(R.removeReminder([], 'zzz').ok, false);
        });
    });

    describe('persistence and migration', () => {
        it('uses the same storage key as before', () => {
            assert.strictEqual(R.REMINDERS_KEY, 'relief_reminders_v1');
        });

        it('migrates old { medicine, time } entries', () => {
            const storage = memoryStorage({
                relief_reminders_v1: JSON.stringify([{ medicine: 'Metformin 500mg', time: '09:00' }, { medicine: 'Iron', time: '21:30' }])
            });
            const list = R.loadReminders(storage);
            assert.strictEqual(list.length, 2);
            assert.strictEqual(list[0].medicine, 'Metformin 500mg');
            assert.strictEqual(list[0].time, '09:00');
            assert.strictEqual(list[0].status, 'active');
            assert.strictEqual(list[0].instructions, '');
            assert.strictEqual(list[0].startDate, '');
            assert.strictEqual(list[0].endDate, '');
            assert.notStrictEqual(list[0].id, list[1].id);
        });

        it('gives migrated entries stable ids across reads', () => {
            const storage = memoryStorage({ relief_reminders_v1: JSON.stringify([{ medicine: 'Iron', time: '21:30' }]) });
            assert.strictEqual(R.loadReminders(storage)[0].id, R.loadReminders(storage)[0].id);
        });

        it('round-trips through save and load', () => {
            const storage = memoryStorage();
            const added = R.addReminder([], base({ instructions: 'after food', endDate: '2026-12-01' }), CTX);
            assert.strictEqual(R.saveReminders(storage, added.reminders), true);
            assert.deepStrictEqual(R.loadReminders(storage), added.reminders);
        });

        it('survives corrupted or unexpected stored data', () => {
            assert.deepStrictEqual(R.loadReminders(memoryStorage({ relief_reminders_v1: '{not json' })), []);
            assert.deepStrictEqual(R.loadReminders(memoryStorage({ relief_reminders_v1: '{"a":1}' })), []);
            const mixed = memoryStorage({ relief_reminders_v1: JSON.stringify([null, 5, { medicine: 'ok', time: '07:00' }, { medicine: 'bad', time: '99:99' }]) });
            assert.strictEqual(R.loadReminders(mixed).length, 1);
        });

        it('returns false instead of throwing when storage refuses a write', () => {
            const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
            assert.strictEqual(R.saveReminders(full, []), false);
        });
    });

    describe('time zones and scheduling', () => {
        it('reads the local date and time of one instant in different zones', () => {
            const instant = new Date('2026-10-24T20:00:00Z');
            assert.deepStrictEqual(R.getLocalParts(instant, 'Asia/Kolkata'), { date: '2026-10-25', time: '01:30' });
            assert.deepStrictEqual(R.getLocalParts(instant, 'America/Los_Angeles'), { date: '2026-10-24', time: '13:00' });
            assert.deepStrictEqual(R.getLocalParts(instant, 'UTC'), { date: '2026-10-24', time: '20:00' });
        });

        it('treats midnight as 00:00 and not 24:00', () => {
            assert.strictEqual(R.getLocalParts(new Date('2026-10-24T18:30:00Z'), 'Asia/Kolkata').time, '00:00');
        });

        it('is due once the clock time is reached, in the device zone', () => {
            const list = R.addReminder([], base({ time: '08:00' }), CTX).reminders;
            // 07:59 IST: not yet, 08:00 IST: due
            assert.strictEqual(R.getDueReminders(list, new Date('2026-10-24T02:29:00Z'), TZ).length, 0);
            assert.strictEqual(R.getDueReminders(list, new Date('2026-10-24T02:30:00Z'), TZ).length, 1);
        });

        it('the same instant is due in one zone and not yet in another', () => {
            const list = R.addReminder([], base({ time: '08:00' }), CTX).reminders;
            const instant = new Date('2026-10-24T14:00:00Z'); // 19:30 in Kolkata, 07:00 in Los Angeles
            assert.strictEqual(R.getDueReminders(list, instant, 'Asia/Kolkata').length, 1);
            assert.strictEqual(R.getDueReminders(list, instant, 'America/Los_Angeles').length, 0);
        });

        it('does not fire again on the same local day after it was shown', () => {
            let list = R.addReminder([], base({ time: '08:00' }), CTX).reminders;
            const id = list[0].id;
            list = R.markNotified(list, id, '2026-10-24');
            assert.strictEqual(R.getDueReminders(list, NOW, TZ).length, 0);
            // next local day it is due again
            assert.strictEqual(R.getDueReminders(list, new Date('2026-10-25T04:30:00Z'), TZ).length, 1);
        });

        it('uses the local calendar day for start and end dates', () => {
            const list = R.addReminder([], base({ startDate: '2026-10-25', endDate: '2026-10-25' }), { ...CTX, today: '2026-10-24' }).reminders;
            const r = list[0];
            // 2026-10-24T20:00Z is already 25 Oct in Kolkata but still 24 Oct in Los Angeles
            const instant = new Date('2026-10-24T20:00:00Z');
            assert.strictEqual(R.getReminderState(r, instant, 'Asia/Kolkata'), 'active');
            assert.strictEqual(R.getReminderState(r, instant, 'America/Los_Angeles'), 'upcoming');
            assert.strictEqual(R.getReminderState(r, new Date('2026-10-26T04:30:00Z'), 'Asia/Kolkata'), 'expired');
        });

        it('paused, completed and out-of-range reminders are never due', () => {
            const added = R.addReminder([], base({ time: '00:00' }), CTX).reminders;
            const id = added[0].id;
            assert.strictEqual(R.getDueReminders(R.setPaused(added, id, true).reminders, NOW, TZ).length, 0);
            assert.strictEqual(R.getDueReminders(R.completeReminder(added, id).reminders, NOW, TZ).length, 0);
            const future = R.addReminder([], base({ time: '00:00', startDate: '2026-11-01' }), CTX).reminders;
            assert.strictEqual(R.getDueReminders(future, NOW, TZ).length, 0);
        });

        it('counts only active reminders', () => {
            let list = R.addReminder([], base(), { ...CTX, idFn: () => 'a' }).reminders;
            list = R.addReminder(list, base({ medicine: 'Iron' }), { ...CTX, idFn: () => 'b' }).reminders;
            list = R.setPaused(list, 'b', true).reminders;
            assert.strictEqual(R.countActive(list, NOW, TZ), 1);
        });

        it('warns when the saved zone differs from the current one', () => {
            const r = R.addReminder([], base(), CTX).reminder;
            assert.strictEqual(R.getTimeZoneWarning(r, TZ), '');
            assert.match(R.getTimeZoneWarning(r, 'Europe/London'), /Asia\/Kolkata/);
            assert.strictEqual(R.getTimeZoneWarning({ ...r, timeZone: '' }, 'Europe/London'), '');
        });
    });

    describe('notifications and wording', () => {
        it('maps the browser permission, including unsupported browsers', () => {
            assert.strictEqual(R.getNotificationPermission(undefined), 'unsupported');
            assert.strictEqual(R.getNotificationPermission({}), 'unsupported');
            assert.strictEqual(R.getNotificationPermission({ permission: 'default' }), 'default');
            assert.strictEqual(R.getNotificationPermission({ permission: 'denied' }), 'denied');
            assert.strictEqual(R.getNotificationPermission({ permission: 'granted' }), 'granted');
        });

        it('explains the permission request before it is made', () => {
            assert.match(R.getPermissionMessage('default'), /only after you press the button/);
        });

        it('mentions the in-app banner when notifications are denied or unsupported', () => {
            assert.match(R.getPermissionMessage('denied'), /banner on this page/);
            assert.match(R.getPermissionMessage('unsupported'), /banner on this page/);
        });

        it('builds a banner message from the reminder', () => {
            const msg = R.buildReminderMessage({ medicine: 'Iron', time: '21:30', instructions: 'after dinner' });
            assert.match(msg, /Iron/);
            assert.match(msg, /21:30/);
            assert.match(msg, /after dinner/);
        });

        it('states this is a reminder tool and not medical advice', () => {
            assert.match(R.REMINDER_DISCLAIMER, /does not suggest medicines, doses or schedules/);
        });

        it('is honest about browser-only storage and time zone behaviour', () => {
            assert.match(R.PERSISTENCE_NOTE, /only in this browser/);
            assert.match(R.PERSISTENCE_NOTE, /nothing is synced/);
            assert.match(R.TIMEZONE_NOTE, /time zone/);
            assert.match(R.TIMEZONE_NOTE, /open in a tab/);
        });

        it('escapes user text before it is put into HTML', () => {
            assert.strictEqual(R.escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
        });
    });

    describe('dashboard wiring (regression)', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashboard.html'), 'utf8');

        it('loads reminders.js before dashboard.js', () => {
            const a = html.indexOf('reminders.js');
            const b = html.indexOf('dashboard.js');
            assert.ok(a > -1 && b > -1 && a < b);
        });

        it('keeps the element ids the script relies on', () => {
            for (const id of ['reminder-form', 'reminder-list', 'medicine', 'time', 'instructions', 'start-date', 'end-date',
                'reminder-banner', 'notify-enable', 'notify-status', 'kpi-reminders', 'timeline']) {
                assert.ok(html.includes(`id="${id}"`), id);
            }
        });
    });
});
