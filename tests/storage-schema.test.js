/**
 * Tests for Issue #93: versioned, safe migration of the data kept in localStorage.
 * Covers old (no version), current, newer and corrupt data, repeat runs, storage
 * errors and that nothing is logged or leaked into the result.
 * Run with: node --test tests/storage-schema.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../assets/js/storage-schema.js');
const R = require('../assets/js/reminders.js');
const P = require('../assets/js/privacy-data.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Minimal Storage that counts writes and can be told to fail.
function memoryStorage(initial, opts) {
    const o = opts || {};
    const data = new Map(Object.entries(initial || {}));
    const writes = [];
    return {
        writes,
        data,
        getItem(k) {
            if (o.failRead) throw new Error('blocked');
            return data.has(k) ? data.get(k) : null;
        },
        setItem(k, v) {
            if (o.failWriteKey === k) throw new Error('quota');
            writes.push(['set', k]);
            data.set(k, String(v));
        },
        removeItem(k) {
            writes.push(['remove', k]);
            data.delete(k);
        }
    };
}

const goodReminder = { id: 'r1', medicine: 'Paracetamol 500mg', instructions: 'after food', time: '08:00', status: 'active' };
const legacyReminder = { medicine: 'Old style entry', time: '21:30' };
const goodHistory = { date: '2026-01-02', event: 'Symptom check completed', status: 'Advised doctor consult' };
const goodRequest = { id: 'req-1', doctorId: 3, doctorName: 'Dr. A. Sen', preferredDate: '2026-11-02', preferredWindow: 'morning', patientName: 'Asha Devi', patientEmail: 'asha@example.com', status: 'requested' };
const goodFacility = { id: 'f1', name: 'Block Primary Health Centre', phone: '0000', savedAt: 1 };
const goodDoctor = { id: 3, name: 'Dr. A. Sen', specialty: 'Physician' };

function oldBuildData() {
    return {
        relief_reminders_v1: JSON.stringify([goodReminder, legacyReminder]),
        relief_history_v1: JSON.stringify([goodHistory]),
        relief_appointment_requests: JSON.stringify([goodRequest]),
        relief_saved_facilities: JSON.stringify([goodFacility]),
        selectedDoctor: JSON.stringify(goodDoctor)
    };
}

describe('old data (no version marker)', () => {
    it('keeps every valid record unchanged and writes the version marker', () => {
        const store = memoryStorage(oldBuildData());
        const report = S.migrate(store);
        assert.strictEqual(report.status, 'migrated');
        assert.strictEqual(report.from, 0);
        assert.strictEqual(report.to, S.CURRENT_VERSION);
        assert.deepStrictEqual(report, { status: 'migrated', from: 0, to: 1, kept: 6, dropped: 0 });
        assert.strictEqual(store.data.get(S.VERSION_KEY), '1');
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_reminders_v1')), [goodReminder, legacyReminder]);
        assert.deepStrictEqual(JSON.parse(store.data.get('selectedDoctor')), goodDoctor);
        // Nothing needed rewriting, so only the marker was written.
        assert.deepStrictEqual(store.writes, [['set', S.VERSION_KEY]]);
    });

    it('drops only the broken entries from a list and keeps the good ones', () => {
        const store = memoryStorage({
            relief_reminders_v1: JSON.stringify([
                goodReminder, legacyReminder,
                { id: 'x', medicine: '', time: '09:00' },      // no medicine
                { id: 'y', medicine: 'Iron', time: 'noon' },   // bad time
                'junk', 42, null, ['array']
            ])
        });
        const report = S.migrate(store);
        assert.strictEqual(report.status, 'migrated');
        assert.strictEqual(report.kept, 2);
        assert.strictEqual(report.dropped, 6);
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_reminders_v1')), [goodReminder, legacyReminder]);
    });

    it('the migrated reminders still load through reminders.js', () => {
        const store = memoryStorage({ relief_reminders_v1: JSON.stringify([goodReminder, legacyReminder, 'junk']) });
        S.migrate(store);
        const loaded = R.loadReminders(store);
        assert.deepStrictEqual(loaded.map((r) => r.medicine), ['Paracetamol 500mg', 'Old style entry']);
    });

    it('covers timeline entries, requests and facilities too', () => {
        const store = memoryStorage({
            relief_history_v1: JSON.stringify([goodHistory, { date: 5 }, null]),
            relief_appointment_requests: JSON.stringify([goodRequest, { id: '', status: 'x' }]),
            relief_saved_facilities: JSON.stringify([goodFacility, { id: 'f2' }, { name: 'no id' }])
        });
        const report = S.migrate(store);
        assert.strictEqual(report.kept, 3);
        assert.strictEqual(report.dropped, 5);
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_history_v1')), [goodHistory]);
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_appointment_requests')), [goodRequest]);
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_saved_facilities')), [goodFacility]);
    });

    it('works on an empty browser: only the marker is written', () => {
        const store = memoryStorage({});
        assert.strictEqual(S.migrate(store).status, 'migrated');
        assert.deepStrictEqual(store.writes, [['set', S.VERSION_KEY]]);
    });

    it('leaves unrelated keys and the other relief keys alone', () => {
        const store = memoryStorage({ relief_lang: 'bn', userLocation: '{"lat":1}', theme: 'dark', relief_onboarding_status: 'completed' });
        S.migrate(store);
        assert.strictEqual(store.data.get('relief_lang'), 'bn');
        assert.strictEqual(store.data.get('userLocation'), '{"lat":1}');
        assert.strictEqual(store.data.get('theme'), 'dark');
        assert.strictEqual(store.data.get('relief_onboarding_status'), 'completed');
    });
});

describe('corrupt data', () => {
    it('removes values that are not valid JSON and migrates the rest', () => {
        const store = memoryStorage({
            relief_history_v1: '[{"date":"2026-01-02","event":"Symptom check completed","status":"ok"},{"date":"2026-01-0',
            relief_reminders_v1: JSON.stringify([goodReminder]),
            selectedDoctor: 'Dr. {broken'
        });
        const report = S.migrate(store);
        assert.strictEqual(report.status, 'migrated');
        assert.strictEqual(report.dropped, 2);
        assert.strictEqual(store.data.has('relief_history_v1'), false);
        assert.strictEqual(store.data.has('selectedDoctor'), false);
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_reminders_v1')), [goodReminder]);
    });

    it('removes a value of the wrong type (an object where a list belongs, a list where an object belongs)', () => {
        const store = memoryStorage({
            relief_reminders_v1: '{"medicine":"x","time":"08:00"}',
            relief_saved_facilities: '"just text"',
            selectedDoctor: '[1,2]'
        });
        const report = S.migrate(store);
        assert.strictEqual(report.dropped, 3);
        ['relief_reminders_v1', 'relief_saved_facilities', 'selectedDoctor'].forEach((k) => assert.strictEqual(store.data.has(k), false, k));
    });

    it('removes a list whose entries are all broken', () => {
        const store = memoryStorage({ relief_history_v1: JSON.stringify([null, 1, 'x']) });
        S.migrate(store);
        assert.strictEqual(store.data.has('relief_history_v1'), false);
    });

    it('treats an unreadable version marker as version 0 and repairs it', () => {
        ['abc', '', '-1', '1.5', '{"v":1}', 'NaN'].forEach((bad) => {
            const store = memoryStorage({ ...oldBuildData(), [S.VERSION_KEY]: bad });
            const report = S.migrate(store);
            assert.strictEqual(report.status, 'migrated', 'marker ' + JSON.stringify(bad));
            assert.strictEqual(report.from, 0);
            assert.strictEqual(store.data.get(S.VERSION_KEY), '1');
            assert.deepStrictEqual(JSON.parse(store.data.get('relief_reminders_v1')), [goodReminder, legacyReminder]);
        });
    });
});

describe('current and newer versions', () => {
    it('does nothing when the data is already at the current version', () => {
        const store = memoryStorage({ ...oldBuildData(), [S.VERSION_KEY]: '1' });
        const before = new Map(store.data);
        const report = S.migrate(store);
        assert.strictEqual(report.status, 'current');
        assert.deepStrictEqual(store.writes, []);
        assert.deepStrictEqual(store.data, before);
    });

    it('does not even read the lists at the current version, so broken ones are left to the readers', () => {
        const store = memoryStorage({ relief_history_v1: 'not json', [S.VERSION_KEY]: '1' });
        S.migrate(store);
        assert.strictEqual(store.data.get('relief_history_v1'), 'not json');
    });

    it('leaves data from a newer build exactly as it is', () => {
        const data = { ...oldBuildData(), relief_reminders_v1: '{"schema":2,"items":[]}', [S.VERSION_KEY]: '2' };
        const store = memoryStorage(data);
        const report = S.migrate(store);
        assert.strictEqual(report.status, 'newer');
        assert.strictEqual(report.from, 2);
        assert.deepStrictEqual(store.writes, []);
        assert.strictEqual(store.data.get('relief_reminders_v1'), '{"schema":2,"items":[]}');
        assert.strictEqual(store.data.get(S.VERSION_KEY), '2');
    });
});

describe('running it again', () => {
    it('is idempotent: a second and third run change nothing', () => {
        const store = memoryStorage({
            ...oldBuildData(),
            relief_history_v1: JSON.stringify([goodHistory, 'junk']),
            selectedDoctor: 'broken'
        });
        S.migrate(store);
        const snapshot = JSON.stringify([...store.data]);
        const writesAfterFirst = store.writes.length;
        assert.strictEqual(S.migrate(store).status, 'current');
        assert.strictEqual(S.migrate(store).status, 'current');
        assert.strictEqual(JSON.stringify([...store.data]), snapshot);
        assert.strictEqual(store.writes.length, writesAfterFirst);
    });

    it('a migration that was cut off part way finishes on the next run', () => {
        const store = memoryStorage({
            relief_reminders_v1: JSON.stringify([goodReminder, 'junk']),
            relief_history_v1: JSON.stringify([goodHistory, 'junk'])
        }, { failWriteKey: 'relief_history_v1' });
        const first = S.migrate(store);
        assert.strictEqual(first.status, 'incomplete');
        assert.strictEqual(store.data.has(S.VERSION_KEY), false, 'marker must not be written after a failed write');
        // The list that failed to write is untouched, the other one is already clean.
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_history_v1')), [goodHistory, 'junk']);
        assert.deepStrictEqual(JSON.parse(store.data.get('relief_reminders_v1')), [goodReminder]);

        const healthy = memoryStorage(Object.fromEntries(store.data));
        const second = S.migrate(healthy);
        assert.strictEqual(second.status, 'migrated');
        assert.deepStrictEqual(JSON.parse(healthy.data.get('relief_history_v1')), [goodHistory]);
        assert.deepStrictEqual(JSON.parse(healthy.data.get('relief_reminders_v1')), [goodReminder]);
        assert.strictEqual(healthy.data.get(S.VERSION_KEY), '1');
    });
});

describe('storage that fails', () => {
    it('never throws when storage is missing, blocked or refuses writes', () => {
        assert.strictEqual(S.migrate(null).status, 'unavailable');
        assert.strictEqual(S.migrate(undefined).status, 'unavailable');
        assert.strictEqual(S.migrate(memoryStorage({}, { failRead: true })).status, 'unavailable');
        assert.strictEqual(S.migrate(memoryStorage({}, { failWriteKey: S.VERSION_KEY })).status, 'incomplete');
        assert.strictEqual(S.migrate({}).status, 'unavailable');
    });
});

describe('no personal data leaks', () => {
    const secrets = ['Asha Devi', 'asha@example.com', 'Paracetamol 500mg', 'Block Primary Health Centre'];

    function stub(method) {
        const calls = [];
        const original = console[method];
        console[method] = (...args) => calls.push(args);
        return { calls, restore: () => { console[method] = original; } };
    }

    it('writes nothing to the console, even for corrupt data', () => {
        const spies = ['log', 'info', 'warn', 'error', 'debug'].map(stub);
        try {
            S.migrate(memoryStorage({ ...oldBuildData(), relief_history_v1: 'Asha Devi asha@example.com {' }));
            S.migrate(memoryStorage({}, { failRead: true }));
            S.loadHistory(memoryStorage({ relief_history_v1: 'Asha Devi {' }));
        } finally {
            spies.forEach((s) => s.restore());
        }
        spies.forEach((s) => assert.deepStrictEqual(s.calls, []));
    });

    it('the report holds counts and a status word only', () => {
        const store = memoryStorage({ ...oldBuildData(), relief_history_v1: 'Asha Devi asha@example.com {' });
        const report = S.migrate(store);
        const text = JSON.stringify(report);
        secrets.forEach((s) => assert.ok(!text.includes(s), 'report leaked ' + s));
        assert.deepStrictEqual(Object.keys(report).sort(), ['dropped', 'from', 'kept', 'status', 'to']);
        Object.values(report).forEach((v) => assert.ok(typeof v === 'number' || ['migrated', 'current', 'newer', 'incomplete', 'unavailable'].includes(v)));
    });

    it('the script has no console calls at all', () => {
        assert.doesNotMatch(read('assets/js/storage-schema.js'), /console\./);
    });
});

describe('loadHistory', () => {
    it('returns valid entries and skips broken ones', () => {
        const store = memoryStorage({ relief_history_v1: JSON.stringify([goodHistory, null, { date: 1 }]) });
        assert.deepStrictEqual(S.loadHistory(store), [goodHistory]);
    });

    it('returns an empty list for an empty stored list (the user cleared it)', () => {
        assert.deepStrictEqual(S.loadHistory(memoryStorage({ relief_history_v1: '[]' })), []);
    });

    it('returns null for missing, corrupt, wrong type or unreadable storage', () => {
        assert.strictEqual(S.loadHistory(memoryStorage({})), null);
        assert.strictEqual(S.loadHistory(memoryStorage({ relief_history_v1: '[{"date"' })), null);
        assert.strictEqual(S.loadHistory(memoryStorage({ relief_history_v1: '{"a":1}' })), null);
        assert.strictEqual(S.loadHistory(memoryStorage({}, { failRead: true })), null);
        assert.strictEqual(S.loadHistory(null), null);
    });
});

describe('wiring', () => {
    it('the validators accept everything the pages write today', () => {
        // Built with the real writers, so a change to a stored shape fails here.
        const Req = require('../assets/js/appointment-request.js');
        const req = Req.buildRequest({
            doctor: { id: 3, name: 'Dr. A. Sen', specialty: 'Physician' },
            date: '2026-10-30', timeWindow: 'morning',
            name: 'Asha Devi', email: 'asha@example.com', phone: '9876543210', notes: '', consent: true
        }, { now: new Date('2026-10-27T10:00:00') });
        const reminder = R.addReminder([], { medicine: 'Iron tablet', time: '07:30' }, { now: new Date('2026-10-27T10:00:00Z'), timeZone: 'UTC' });
        assert.ok(reminder.ok, 'test setup: reminder was refused');
        const store = memoryStorage({
            relief_appointment_requests: JSON.stringify([req]),
            relief_reminders_v1: JSON.stringify(reminder.reminders)
        });
        const report = S.migrate(store);
        assert.strictEqual(report.dropped, 0, 'a record the app itself writes was rejected');
    });

    it('every key it handles is in the privacy inventory, and the marker is documented', () => {
        S.STORED_KEYS.concat([S.VERSION_KEY]).forEach((k) => assert.ok(P.inventoryKeys().includes(k), k + ' missing from INVENTORY'));
        const doc = read('docs/PRIVACY_AND_DATA.md');
        assert.ok(doc.includes('`' + S.VERSION_KEY + '`'));
        assert.match(doc, /Versioning and migration of the saved data/);
    });

    it('the pages that read the stored data load the migration first', () => {
        const order = {
            'pages/dashboard.html': 'reminders.js',
            'pages/appointments.html': 'appointment-request.js',
            'pages/hospitals.html': 'hospitals.js'
        };
        for (const [page, reader] of Object.entries(order)) {
            const html = read(page);
            const at = html.indexOf('assets/js/storage-schema.js');
            assert.ok(at > -1, page + ' does not load storage-schema.js');
            assert.ok(at < html.indexOf('assets/js/' + reader), page + ': storage-schema.js must load before ' + reader);
        }
    });

    it('the dashboard no longer parses the timeline without a guard', () => {
        assert.doesNotMatch(read('assets/js/dashboard.js'), /JSON\.parse\(localStorage\.getItem\(historyKey\)/);
    });
});
