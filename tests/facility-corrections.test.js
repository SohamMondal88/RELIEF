/**
 * Tests for Issue #27: moderated community corrections for facility information.
 * Validation and sanitising, the client rate limit and duplicate guard, the
 * pending -> approved/rejected state machine, the audit trail, the demo store
 * rules, and the rule that a suggestion never changes the public record.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../assets/js/facility-corrections.js');
const U = require('../assets/js/facility-utils.js');
const ReliefAPI = require('../assets/js/api.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const NOW = Date.parse('2026-10-26T10:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const FACILITIES = U.normalizeFacilities([
    { id: 'fac-001', name: 'Alpha Hospital', type: 'hospital', district: 'Bankura', address: '1 Main Road, Bankura', phone: '+91 3242 250 201', hours: 'Mon to Sat 9:00 to 17:00', services: ['Emergency Care', 'Surgery'], verified: true, source: 'WB Health Dept', lastChecked: '2026-10-01' },
    { id: 'fac-002', name: 'Beta PHC', type: 'phc', district: 'Purulia', address: null, phone: null, hours: null, services: [] }
]);

function input(overrides) {
    return Object.assign({ facilityId: 'fac-001', field: 'hours', proposedValue: 'Mon to Sun 8:00 to 20:00', sourceUrl: '', contact: '', website: '' }, overrides);
}

function valid(overrides) {
    const r = C.validateSubmission(input(overrides), { facilities: FACILITIES });
    assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
    return r.clean;
}

function pendingRecord(overrides) {
    let n = 0;
    const clean = valid(overrides);
    return C.buildCorrection(clean, FACILITIES[0], { now: NOW, id: 'cor-' + (++n) });
}

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        data
    };
}

function clock(start) {
    let t = start === undefined ? NOW : start;
    const fn = () => t;
    fn.advance = (ms) => { t += ms; };
    return fn;
}

function backendError(code, extra) {
    return Object.assign(new Error(code), { code }, extra || {});
}

describe('validation', () => {
    it('accepts a minimal suggestion for each field', () => {
        valid();
        valid({ field: 'phone', proposedValue: '+91 33 2552 1234' });
        valid({ field: 'address', proposedValue: '12 Station Road, Bankura 722101' });
        valid({ field: 'services', proposedValue: 'Emergency Care, Dialysis' });
    });

    it('requires a facility that exists in the directory', () => {
        const none = C.validateSubmission(input({ facilityId: '' }), { facilities: FACILITIES });
        assert.ok(none.errors.facilityId);
        const bogus = C.validateSubmission(input({ facilityId: 'fac-999' }), { facilities: FACILITIES });
        assert.ok(bogus.errors.facilityId);
    });

    it('allows only hours, phone, address and services as the field', () => {
        ['', 'name', 'verified', 'lastChecked', 'source', 'lat', 'reviewState', '__proto__', 'constructor', 'toString', 'HOURS'].forEach((field) => {
            const r = C.validateSubmission(input({ field }), { facilities: FACILITIES });
            assert.ok(r.errors.field, 'field ' + field);
            assert.strictEqual(r.valid, false);
        });
    });

    it('cannot be used to edit verification data', () => {
        const r = C.validateSubmission(input({ field: 'verified', proposedValue: 'true' }), { facilities: FACILITIES });
        assert.strictEqual(r.valid, false);
        assert.deepStrictEqual(Object.keys(C.FIELDS).sort(), ['address', 'hours', 'phone', 'services']);
    });

    it('requires a proposed value and enforces length limits', () => {
        assert.ok(C.validateSubmission(input({ proposedValue: '   ' }), { facilities: FACILITIES }).errors.proposedValue);
        assert.ok(C.validateSubmission(input({ proposedValue: 'ab' }), { facilities: FACILITIES }).errors.proposedValue);
        assert.ok(C.validateSubmission(input({ proposedValue: 'x'.repeat(121) }), { facilities: FACILITIES }).errors.proposedValue);
        assert.ok(C.validateSubmission(input({ field: 'address', proposedValue: 'y'.repeat(201) }), { facilities: FACILITIES }).errors.proposedValue);
    });

    it('checks phone numbers', () => {
        ['abc', '12345', '+91 (33) 1234 5678 9012 3456', 'call me'].forEach((v) => {
            assert.ok(C.validateSubmission(input({ field: 'phone', proposedValue: v }), { facilities: FACILITIES }).errors.proposedValue, v);
        });
        assert.strictEqual(valid({ field: 'phone', proposedValue: '1800-345-6789' }).proposedValue, '1800-345-6789');
    });

    it('sanitises: strips tags, control and direction characters, collapses spaces', () => {
        const clean = valid({ proposedValue: '  <b>Mon</b>\u0000 to\u202E   Sat\u200B 9:00 to 17:00 <script>alert(1)</script>  ' });
        assert.strictEqual(clean.proposedValue, 'Mon to Sat 9:00 to 17:00 alert(1)');
        assert.strictEqual(C.sanitizeText('5 < 6 and 7 > 2'), '5 6 and 7 2');
        assert.doesNotMatch(clean.proposedValue, /[<>\u0000\u202E\u200B]/);
    });

    it('sanitiseText trims to the maximum length', () => {
        assert.strictEqual(C.sanitizeText('a'.repeat(50), 10), 'a'.repeat(10));
        assert.strictEqual(C.sanitizeText(null), '');
        assert.strictEqual(C.sanitizeText({ toString: () => ' x ' }), 'x');
    });

    it('parses services: splits on commas, semicolons and new lines, drops duplicates and blanks', () => {
        assert.deepStrictEqual(C.parseServices('ICU, icu; Dialysis\n\nPediatrics,, '), ['ICU', 'Dialysis', 'Pediatrics']);
        const clean = valid({ field: 'services', proposedValue: 'Radiology, X-Ray' });
        assert.deepStrictEqual(clean.proposedValue, ['Radiology', 'X-Ray']);
    });

    it('limits the number of services', () => {
        const many = Array.from({ length: 11 }, (_, i) => 'Service ' + i).join(', ');
        assert.ok(C.validateSubmission(input({ field: 'services', proposedValue: many }), { facilities: FACILITIES }).errors.proposedValue);
        assert.ok(C.validateSubmission(input({ field: 'services', proposedValue: ' , ' }), { facilities: FACILITIES }).errors.proposedValue);
    });

    it('rejects a value that is already what the directory shows', () => {
        const same = C.validateSubmission(input({ proposedValue: 'mon to sat  9:00 to 17:00' }), { facilities: FACILITIES });
        assert.ok(same.errors.proposedValue);
        const sameServices = C.validateSubmission(input({ field: 'services', proposedValue: 'surgery, emergency care' }), { facilities: FACILITIES });
        assert.ok(sameServices.errors.proposedValue);
    });

    it('source link is optional, but must be a safe web address', () => {
        assert.strictEqual(valid({ sourceUrl: '' }).sourceUrl, '');
        assert.strictEqual(valid({ sourceUrl: 'https://wbhealth.gov.in/notice?id=4' }).sourceUrl, 'https://wbhealth.gov.in/notice?id=4');
        ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/a', 'notaurl', 'http://localhost/x', 'https://user:pw@example.org/', 'https://' + 'a'.repeat(300) + '.org'].forEach((u) => {
            assert.ok(C.validateSubmission(input({ sourceUrl: u }), { facilities: FACILITIES }).errors.sourceUrl, u);
        });
    });

    it('contact is optional, and when given must be an email or a phone number', () => {
        assert.strictEqual(valid({ contact: '' }).contact, '');
        assert.strictEqual(valid({ contact: 'person@example.org' }).contact, 'person@example.org');
        assert.strictEqual(valid({ contact: '+91 98765 43210' }).contact, '+91 98765 43210');
        ['my name is Asha', 'asha@', '123'].forEach((v) => {
            assert.ok(C.validateSubmission(input({ contact: v }), { facilities: FACILITIES }).errors.contact, v);
        });
    });

    it('treats a filled honeypot as spam', () => {
        const r = C.validateSubmission(input({ website: 'http://spam.example' }), { facilities: FACILITIES });
        assert.strictEqual(r.valid, false);
        assert.strictEqual(r.spam, true);
    });

    it('the cleaned record keeps only the fields it needs (no identity, no extras)', () => {
        const r = C.validateSubmission(Object.assign(input(), { name: 'Asha', ip: '1.2.3.4', userId: 'u1', verified: true }), { facilities: FACILITIES });
        assert.deepStrictEqual(Object.keys(r.clean).sort(), ['contact', 'facilityId', 'field', 'proposedValue', 'sourceUrl']);
    });

    it('works with real records from assets/data/facilities.json', () => {
        const data = JSON.parse(read('assets/data/facilities.json'));
        const real = U.normalizeFacilities(data);
        assert.ok(real.length > 0);
        const r = C.validateSubmission({ facilityId: real[0].id, field: 'hours', proposedValue: 'Mon to Fri 9:00 to 16:00' }, { facilities: real });
        assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
    });
});

describe('rate limit and duplicate guard (client side)', () => {
    const clean = () => valid();

    it('allows the first submission', () => {
        assert.strictEqual(C.checkRateLimit([], NOW, clean()).allowed, true);
    });

    it('blocks a second one inside the minimum interval', () => {
        const log = [{ at: NOW - 5000, fingerprint: 'x' }];
        const r = C.checkRateLimit(log, NOW, clean());
        assert.strictEqual(r.allowed, false);
        assert.strictEqual(r.reason, 'too-fast');
        assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= C.LIMITS.minIntervalMs);
    });

    it('blocks the fourth in an hour and the eleventh in a day', () => {
        const hour = [10, 20, 30].map((m) => ({ at: NOW - m * MIN, fingerprint: 'h' + m }));
        assert.strictEqual(C.checkRateLimit(hour, NOW, clean()).reason, 'hourly');

        const day = Array.from({ length: 10 }, (_, i) => ({ at: NOW - (2 + i * 2) * HOUR, fingerprint: 'd' + i }));
        assert.strictEqual(C.checkRateLimit(day, NOW, clean()).reason, 'daily');
    });

    it('lets people send again once the windows pass', () => {
        const old = [{ at: NOW - 2 * HOUR, fingerprint: 'a' }, { at: NOW - 3 * HOUR, fingerprint: 'b' }, { at: NOW - 4 * HOUR, fingerprint: 'c' }];
        assert.strictEqual(C.checkRateLimit(old, NOW, clean()).allowed, true);
    });

    it('blocks the same change sent again within a week, ignoring case and spacing', () => {
        const log = [{ at: NOW - 2 * DAY, fingerprint: C.fingerprint(clean()) }];
        assert.strictEqual(C.checkRateLimit(log, NOW, clean()).reason, 'duplicate');
        const shouting = valid({ proposedValue: 'MON TO SUN   8:00 TO 20:00' });
        assert.strictEqual(C.checkRateLimit(log, NOW, shouting).reason, 'duplicate');
        assert.strictEqual(C.checkRateLimit(log, NOW + 8 * DAY, clean()).allowed, true);
    });

    it('a different value for the same field is not a duplicate', () => {
        const log = [{ at: NOW - 2 * DAY, fingerprint: C.fingerprint(clean()) }];
        assert.strictEqual(C.checkRateLimit(log, NOW, valid({ proposedValue: 'Open 24 hours' })).allowed, true);
    });

    it('ignores damaged log entries instead of crashing', () => {
        const log = [null, 'x', { at: 'now' }, { at: NaN }, { at: NOW + DAY * 5, fingerprint: 'future' }];
        assert.strictEqual(C.checkRateLimit(log, NOW, clean()).allowed, true);
        assert.strictEqual(C.checkRateLimit(undefined, NOW, clean()).allowed, true);
    });
});

describe('state machine: pending -> approved | rejected', () => {
    it('a new correction is pending with one "submitted" entry and a snapshot of the current value', () => {
        const r = pendingRecord();
        assert.strictEqual(r.status, 'pending');
        assert.strictEqual(r.currentValue, 'Mon to Sat 9:00 to 17:00');
        assert.strictEqual(r.facilityName, 'Alpha Hospital');
        assert.strictEqual(r.history.length, 1);
        assert.strictEqual(r.history[0].action, 'submitted');
        assert.strictEqual(r.decidedAt, null);
    });

    it('knows exactly three statuses, none of them a facility review state', () => {
        assert.deepStrictEqual(C.STATUSES, ['pending', 'approved', 'rejected']);
    });

    it('approve needs a moderator name and evidence', () => {
        const rec = pendingRecord();
        const noEvidence = C.decide(rec, { decision: 'approve', actor: 'Meera' }, { now: NOW });
        assert.strictEqual(noEvidence.ok, false);
        assert.ok(noEvidence.errors.evidence);
        const shortEvidence = C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: 'ok' }, { now: NOW });
        assert.ok(shortEvidence.errors.evidence);
        const noActor = C.decide(rec, { decision: 'approve', evidence: 'Called the front desk, confirmed' }, { now: NOW });
        assert.ok(noActor.errors.actor);
    });

    it('a source link on the suggestion is not a substitute for moderator evidence', () => {
        const rec = pendingRecord({ sourceUrl: 'https://example.org/notice' });
        const r = C.decide(rec, { decision: 'approve', actor: 'Meera' }, { now: NOW });
        assert.strictEqual(r.ok, false);
        assert.ok(r.errors.evidence);
    });

    it('reject needs a reason', () => {
        const rec = pendingRecord();
        const r = C.decide(rec, { decision: 'reject', actor: 'Meera', reason: '' }, { now: NOW });
        assert.strictEqual(r.ok, false);
        assert.ok(r.errors.reason);
    });

    it('rejects anything but approve or reject', () => {
        const rec = pendingRecord();
        ['', 'verified', 'delete', undefined].forEach((decision) => {
            assert.ok(C.decide(rec, { decision, actor: 'Meera', reason: 'because', evidence: 'long enough evidence' }, { now: NOW }).errors.decision);
        });
    });

    it('approves with evidence and records who, when and why', () => {
        const rec = pendingRecord({ contact: 'person@example.org' });
        const later = NOW + HOUR;
        const r = C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: 'Phoned reception on 26 Oct; hours confirmed' }, { now: later });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.record.status, 'approved');
        assert.strictEqual(r.record.decidedBy, 'Meera');
        assert.strictEqual(r.record.decidedAt, new Date(later).toISOString());
        assert.strictEqual(r.record.evidence, 'Phoned reception on 26 Oct; hours confirmed');
    });

    it('rejects with a reason', () => {
        const rec = pendingRecord();
        const r = C.decide(rec, { decision: 'reject', actor: 'Meera', reason: 'Could not confirm with the hospital' }, { now: NOW + MIN });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.record.status, 'rejected');
        assert.strictEqual(r.record.decisionReason, 'Could not confirm with the hospital');
    });

    it('a decision is final: no second decision, no flipping', () => {
        const rec = pendingRecord();
        const approved = C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW }).record;
        const again = C.decide(approved, { decision: 'reject', actor: 'Ravi', reason: 'changed my mind' }, { now: NOW + MIN });
        assert.strictEqual(again.ok, false);
        assert.match(again.errors.form, /already approved/);
        const rejected = C.decide(rec, { decision: 'reject', actor: 'Meera', reason: 'No proof found' }, { now: NOW }).record;
        assert.strictEqual(C.decide(rejected, { decision: 'approve', actor: 'Ravi', evidence: 'Confirmed by phone call' }, { now: NOW }).ok, false);
    });

    it('refuses a record with an unknown status', () => {
        assert.strictEqual(C.decide({ status: 'verified' }, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW }).ok, false);
        assert.strictEqual(C.decide(null, { decision: 'approve' }, { now: NOW }).ok, false);
    });

    it('does not edit the record it was given', () => {
        const rec = pendingRecord({ contact: 'person@example.org' });
        const snapshot = JSON.stringify(rec);
        C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW });
        assert.strictEqual(JSON.stringify(rec), snapshot);
    });

    it('wipes the reporter contact detail when a decision is made', () => {
        const rec = pendingRecord({ contact: 'person@example.org' });
        assert.strictEqual(rec.contact, 'person@example.org');
        const approved = C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW }).record;
        assert.strictEqual(approved.contact, '');
        const rejected = C.decide(rec, { decision: 'reject', actor: 'Meera', reason: 'No proof found' }, { now: NOW }).record;
        assert.strictEqual(rejected.contact, '');
        assert.doesNotMatch(JSON.stringify(approved), /person@example\.org/);
    });

    it('sanitises moderator text before it is stored', () => {
        const r = C.decide(pendingRecord(), { decision: 'reject', actor: '<i>Meera</i>', reason: '<script>x</script> no proof' }, { now: NOW }).record;
        assert.doesNotMatch(JSON.stringify(r), /[<>]/);
    });
});

describe('audit trail', () => {
    it('keeps earlier entries untouched and appends in order with increasing numbers', () => {
        const rec = pendingRecord();
        const before = JSON.stringify(rec.history[0]);
        const done = C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW + HOUR }).record;
        assert.strictEqual(done.history.length, 2);
        assert.strictEqual(JSON.stringify(done.history[0]), before);
        assert.deepStrictEqual(done.history.map((h) => h.seq), [1, 2]);
        assert.deepStrictEqual(done.history.map((h) => h.action), ['submitted', 'approved']);
        assert.strictEqual(done.history[1].by, 'Meera');
        assert.strictEqual(done.history[1].evidence, 'Confirmed by phone call');
        assert.ok(done.history[1].at > done.history[0].at);
    });

    it('a rejected decision is logged with its reason', () => {
        const done = C.decide(pendingRecord(), { decision: 'reject', actor: 'Ravi', reason: 'Source is a forum post' }, { now: NOW + MIN }).record;
        assert.strictEqual(done.history[1].action, 'rejected');
        assert.strictEqual(done.history[1].note, 'Source is a forum post');
    });

    it('a failed decision leaves no trace', () => {
        const rec = pendingRecord();
        const bad = C.decide(rec, { decision: 'approve', actor: 'Meera', evidence: '' }, { now: NOW });
        assert.strictEqual(bad.record, null);
        assert.strictEqual(rec.history.length, 1);
    });

    it('decisionLog lists every event, newest first', () => {
        const a = pendingRecord();
        const b = C.buildCorrection(valid({ field: 'phone', proposedValue: '+91 33 2552 1234' }), FACILITIES[0], { now: NOW + 2 * MIN, id: 'cor-b' });
        const aDone = C.decide(a, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW + 5 * MIN }).record;
        const log = C.decisionLog([aDone, b]);
        assert.deepStrictEqual(log.map((r) => r.action), ['approved', 'submitted', 'submitted']);
        assert.strictEqual(log[0].by, 'Meera');
        assert.strictEqual(log[0].facilityName, 'Alpha Hospital');
        assert.deepStrictEqual(C.decisionLog(null), []);
    });
});

describe('approved changes are handed to maintainers, not applied', () => {
    it('approvedPatch lists only approved corrections, with the old and new value and the evidence', () => {
        const a = C.decide(pendingRecord(), { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' }, { now: NOW }).record;
        const r = C.decide(pendingRecord({ field: 'phone', proposedValue: '+91 33 2552 1234' }), { decision: 'reject', actor: 'Meera', reason: 'No proof found' }, { now: NOW }).record;
        const p = pendingRecord({ field: 'address', proposedValue: '12 Station Road, Bankura' });
        const patch = C.approvedPatch([a, r, p]);
        assert.strictEqual(patch.length, 1);
        assert.deepStrictEqual(patch[0], {
            correctionId: a.id,
            facilityId: 'fac-001',
            facilityName: 'Alpha Hospital',
            field: 'hours',
            from: 'Mon to Sat 9:00 to 17:00',
            to: 'Mon to Sun 8:00 to 20:00',
            evidence: 'Confirmed by phone call',
            sourceUrl: '',
            approvedBy: 'Meera',
            approvedAt: new Date(NOW).toISOString(),
            applied: false
        });
    });

    it('no function in the module changes a facility, and the module never touches verification fields', () => {
        const code = stripComments(read('assets/js/facility-corrections.js'));
        assert.doesNotMatch(code, /\.(verified|lastChecked|source|reviewState|verifiedBy|reviewLog)\s*=[^=]/);
        assert.doesNotMatch(code, /facilities\.json|writeFile|require\(/);
        const names = Object.keys(C);
        assert.ok(!names.some((n) => /^apply|^publish|^update|^edit/i.test(n)), names.join(','));
    });

    it('submitting and approving leave the facility records exactly as they were', async () => {
        const frozen = JSON.parse(JSON.stringify(FACILITIES));
        frozen.forEach((f) => Object.freeze(f));
        Object.freeze(frozen);
        const before = JSON.stringify(frozen);
        const file = read('assets/data/facilities.json');
        const hash = crypto.createHash('sha256').update(file).digest('hex');

        const storage = memoryStorage();
        const store = C.createStore({ api: null, storage, demo: true, facilities: frozen, now: clock() });
        const sent = await store.submit(input());
        assert.strictEqual(sent.ok, true);
        const done = await store.review(sent.correction.id, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' });
        assert.strictEqual(done.ok, true);

        assert.strictEqual(JSON.stringify(frozen), before);
        assert.strictEqual(crypto.createHash('sha256').update(read('assets/data/facilities.json')).digest('hex'), hash);
        assert.strictEqual(U.normalizeFacilities({ facilities: frozen })[0].hours, 'Mon to Sat 9:00 to 17:00');
        assert.strictEqual(U.normalizeFacilities({ facilities: frozen })[0].verified, true);
    });

    it('the public directory code never reads the correction queue', () => {
        ['assets/js/hospitals.js', 'assets/js/facility-utils.js'].forEach((file) => {
            const code = stripComments(read(file));
            assert.doesNotMatch(code, /relief_demo_facility_corrections|FacilityCorrections|DEMO_QUEUE_KEY/, file);
        });
    });
});

describe('store: demo queue rules', () => {
    function demoStore(extra) {
        const storage = memoryStorage();
        const now = clock();
        let n = 0;
        const store = C.createStore(Object.assign({ api: null, storage, demo: true, facilities: FACILITIES, now, idFn: () => 'cor-' + (++n) }, extra || {}));
        return { store, storage, now };
    }

    it('queues in the browser in demo mode, marked as demo', async () => {
        const { store, storage } = demoStore();
        const r = await store.submit(input());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.mode, 'demo');
        assert.strictEqual(r.demo, true);
        const queue = JSON.parse(storage.data[C.DEMO_QUEUE_KEY]);
        assert.strictEqual(queue.length, 1);
        assert.strictEqual(queue[0].demo, true);
        assert.strictEqual(queue[0].status, 'pending');
    });

    it('does NOT queue locally outside demo mode when the backend is missing', async () => {
        const { store, storage } = demoStore({ demo: false });
        const r = await store.submit(input());
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.kind, 'unavailable');
        assert.strictEqual(storage.data[C.DEMO_QUEUE_KEY], undefined);
    });

    it('does NOT queue locally outside demo mode when the backend is down', async () => {
        const api = { submitFacilityCorrection: async () => { throw backendError('backend-unavailable'); } };
        const { store, storage } = demoStore({ api, demo: false });
        const r = await store.submit(input());
        assert.strictEqual(r.kind, 'unavailable');
        assert.strictEqual(storage.data[C.DEMO_QUEUE_KEY], undefined);
        assert.strictEqual(storage.data[C.SUBMISSION_LOG_KEY], undefined);
    });

    it('falls back to the demo queue in demo mode when the backend is down', async () => {
        const api = { submitFacilityCorrection: async () => { throw backendError('backend-unavailable'); } };
        const { store } = demoStore({ api });
        const r = await store.submit(input());
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.mode, 'demo');
    });

    it('sends only the cleaned fields to the backend and does not touch the local queue', async () => {
        let sent;
        const api = { submitFacilityCorrection: async (c) => { sent = c; return { id: 'srv-1', status: 'pending' }; } };
        const { store, storage } = demoStore({ api, demo: false });
        const r = await store.submit(Object.assign(input({ contact: 'person@example.org' }), { name: 'Asha', ip: '1.1.1.1' }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.mode, 'server');
        assert.strictEqual(r.demo, false);
        assert.deepStrictEqual(Object.keys(sent).sort(), ['contact', 'facilityId', 'field', 'proposedValue', 'sourceUrl']);
        assert.strictEqual(storage.data[C.DEMO_QUEUE_KEY], undefined);
    });

    it('does not call the backend with an invalid or spam submission', async () => {
        let calls = 0;
        const api = { submitFacilityCorrection: async () => { calls++; return {}; } };
        const { store } = demoStore({ api });
        assert.strictEqual((await store.submit(input({ field: 'verified' }))).kind, 'invalid');
        assert.strictEqual((await store.submit(input({ website: 'x' }))).kind, 'spam');
        assert.strictEqual(calls, 0);
    });

    it('applies the rate limit and the duplicate guard through the store', async () => {
        const { store, now } = demoStore();
        assert.strictEqual((await store.submit(input())).ok, true);
        const dup = await store.submit(input());
        assert.strictEqual(dup.kind, 'duplicate');
        const fast = await store.submit(input({ proposedValue: 'Open 24 hours' }));
        assert.strictEqual(fast.kind, 'rate-limited');
        now.advance(C.LIMITS.minIntervalMs + 1);
        assert.strictEqual((await store.submit(input({ proposedValue: 'Open 24 hours' }))).ok, true);
        now.advance(C.LIMITS.minIntervalMs + 1);
        assert.strictEqual((await store.submit(input({ proposedValue: 'Open 8 to 8' }))).ok, true);
        now.advance(C.LIMITS.minIntervalMs + 1);
        assert.strictEqual((await store.submit(input({ proposedValue: 'Open 9 to 9' }))).kind, 'rate-limited'); // 4th in an hour
    });

    it('reports the backend rate limit and rejection without falling back to the demo queue', async () => {
        const limited = demoStore({ api: { submitFacilityCorrection: async () => { throw backendError('rate-limited'); } } });
        assert.strictEqual((await limited.store.submit(input())).kind, 'rate-limited');
        assert.strictEqual(limited.storage.data[C.DEMO_QUEUE_KEY], undefined);

        const rejected = demoStore({ api: { submitFacilityCorrection: async () => { throw backendError('rejected', { details: { errors: { proposedValue: 'Not accepted' } } }); } } });
        const r = await rejected.store.submit(input());
        assert.strictEqual(r.kind, 'invalid');
        assert.strictEqual(r.errors.proposedValue, 'Not accepted');
        assert.strictEqual(rejected.storage.data[C.DEMO_QUEUE_KEY], undefined);
    });

    it('does not add the same pending change twice even with a cleared rate-limit log', async () => {
        const { store, storage, now } = demoStore();
        await store.submit(input());
        delete storage.data[C.SUBMISSION_LOG_KEY];
        now.advance(C.LIMITS.minIntervalMs + 1);
        assert.strictEqual((await store.submit(input())).kind, 'duplicate');
        assert.strictEqual(JSON.parse(storage.data[C.DEMO_QUEUE_KEY]).length, 1);
    });

    it('survives unusable storage', async () => {
        const { store } = demoStore({ storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
        const r = await store.submit(input());
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.kind, 'storage');
    });

    it('survives a corrupted queue', async () => {
        const storage = memoryStorage({ [C.DEMO_QUEUE_KEY]: '{not json' });
        const store = C.createStore({ api: null, storage, demo: true, facilities: FACILITIES, now: clock() });
        assert.strictEqual((await store.list({ status: 'pending' })).items.length, 0);
        assert.strictEqual((await store.submit(input())).ok, true);
    });

    it('moderation in demo: approve, reject, final, and the log shows each step', async () => {
        const { store, now } = demoStore();
        const a = (await store.submit(input())).correction;
        now.advance(C.LIMITS.minIntervalMs + 1);
        const b = (await store.submit(input({ field: 'phone', proposedValue: '+91 33 2552 1234' }))).correction;

        let list = await store.list({ status: 'pending' });
        assert.strictEqual(list.items.length, 2);

        now.advance(MIN);
        const bad = await store.review(a.id, { decision: 'approve', actor: 'Meera', evidence: '' });
        assert.strictEqual(bad.kind, 'invalid');
        assert.ok(bad.errors.evidence);

        assert.strictEqual((await store.review(a.id, { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' })).ok, true);
        assert.strictEqual((await store.review(b.id, { decision: 'reject', actor: 'Meera', reason: 'No proof found' })).ok, true);
        const again = await store.review(a.id, { decision: 'reject', actor: 'Ravi', reason: 'changed my mind' });
        assert.strictEqual(again.ok, false);
        assert.strictEqual(again.kind, 'final');
        assert.strictEqual((await store.review('nope', { decision: 'reject', actor: 'Ravi', reason: 'no such one' })).kind, 'not-found');

        list = await store.list({ status: 'all' });
        assert.deepStrictEqual(list.items.map((r) => r.status).sort(), ['approved', 'rejected']);
        const log = C.decisionLog(list.items);
        assert.strictEqual(log.length, 4);
        assert.strictEqual(C.approvedPatch(list.items).length, 1);
    });

    it('review outside demo mode without a backend is refused and changes nothing', async () => {
        const storage = memoryStorage({ [C.DEMO_QUEUE_KEY]: JSON.stringify([pendingRecord()]) });
        const store = C.createStore({ api: null, storage, demo: false, facilities: FACILITIES, now: clock() });
        const r = await store.review('cor-1', { decision: 'approve', actor: 'Meera', evidence: 'Confirmed by phone call' });
        assert.strictEqual(r.kind, 'unavailable');
        assert.strictEqual(JSON.parse(storage.data[C.DEMO_QUEUE_KEY])[0].status, 'pending');
        assert.strictEqual((await store.list({})).kind, 'unavailable');
    });

    it('server review does not send a moderator name from the page and checks evidence first', async () => {
        let calls = [];
        const api = { reviewFacilityCorrection: async (id, d) => { calls.push([id, d]); return { id, status: 'approved' }; } };
        const store = C.createStore({ api, storage: memoryStorage(), demo: false, facilities: FACILITIES, now: clock() });
        const blocked = await store.review('srv-1', { decision: 'approve', actor: 'Mallory', evidence: '' });
        assert.strictEqual(blocked.kind, 'invalid');
        assert.strictEqual(calls.length, 0);
        const ok = await store.review('srv-1', { decision: 'approve', actor: 'Mallory', evidence: 'Confirmed by phone call' });
        assert.strictEqual(ok.ok, true);
        assert.deepStrictEqual(calls[0], ['srv-1', { decision: 'approve', reason: '', evidence: 'Confirmed by phone call' }]);
    });

    it('a 403 from the backend is "needs a moderator account", never a demo fallback', async () => {
        const api = {
            listFacilityCorrections: async () => { throw backendError('forbidden'); },
            reviewFacilityCorrection: async () => { throw backendError('forbidden'); }
        };
        const store = C.createStore({ api, storage: memoryStorage(), demo: true, facilities: FACILITIES, now: clock() });
        assert.strictEqual((await store.list({})).kind, 'forbidden');
        assert.strictEqual((await store.review('x', { decision: 'reject', actor: 'Ravi', reason: 'no proof here' })).kind, 'forbidden');
    });

    it('server list accepts an array or { corrections } and drops records with unknown status', async () => {
        const rows = [{ id: '1', status: 'pending' }, { id: '2', status: 'verified' }];
        const a = C.createStore({ api: { listFacilityCorrections: async () => rows }, storage: null, demo: false });
        assert.strictEqual((await a.list({})).items.length, 1);
        const b = C.createStore({ api: { listFacilityCorrections: async () => ({ corrections: rows }) }, storage: null, demo: false });
        assert.strictEqual((await b.list({})).items.length, 1);
    });
});

describe('ReliefAPI correction methods with a mocked fetch', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        delete globalThis.window;
    });

    function res(data, status) {
        return { ok: (status || 200) < 300, status: status || 200, headers: { get: () => 'application/json' }, json: async () => data };
    }

    it('are unavailable without a backend', async () => {
        globalThis.fetch = async () => res({});
        await assert.rejects(() => ReliefAPI.submitFacilityCorrection({}), { code: 'backend-unavailable' });
        await assert.rejects(() => ReliefAPI.listFacilityCorrections(), { code: 'backend-unavailable' });
        await assert.rejects(() => ReliefAPI.reviewFacilityCorrection('a', {}), { code: 'backend-unavailable' });
    });

    it('send the documented requests', async () => {
        globalThis.window = { RELIEF_BACKEND_URL: 'https://api.example.org' };
        const seen = [];
        globalThis.fetch = async (url, init) => { seen.push({ url, method: init.method, body: init.body, credentials: init.credentials }); return res({ ok: true }); };
        await ReliefAPI.submitFacilityCorrection({ facilityId: 'fac-001', field: 'hours', proposedValue: 'x', sourceUrl: '', contact: '' });
        await ReliefAPI.listFacilityCorrections({ status: 'pending' });
        await ReliefAPI.listFacilityCorrections();
        await ReliefAPI.reviewFacilityCorrection('a/b c', { decision: 'reject', reason: 'No proof found', evidence: '' });
        assert.deepStrictEqual(seen.map((s) => [s.method, s.url]), [
            ['POST', 'https://api.example.org/v1/facility-corrections'],
            ['GET', 'https://api.example.org/v1/facility-corrections?status=pending'],
            ['GET', 'https://api.example.org/v1/facility-corrections'],
            ['POST', 'https://api.example.org/v1/facility-corrections/a%2Fb%20c/decision']
        ]);
        assert.ok(seen.every((s) => s.credentials === 'include'));
        assert.deepStrictEqual(JSON.parse(seen[0].body), { facilityId: 'fac-001', field: 'hours', proposedValue: 'x', sourceUrl: '', contact: '' });
    });

    it('map 429, 403 and 422 to error codes the store understands', async () => {
        globalThis.window = { RELIEF_BACKEND_URL: 'https://api.example.org' };
        for (const [status, code] of [[429, 'rate-limited'], [403, 'forbidden'], [401, 'unauthenticated'], [422, 'rejected'], [500, 'backend-unavailable']]) {
            globalThis.fetch = async () => res({ errors: { field: 'bad' } }, status);
            await assert.rejects(() => ReliefAPI.submitFacilityCorrection({}), { code });
        }
    });
});

describe('pages', () => {
    it('hospitals page has the correction form with a hidden honeypot and loads the scripts in order', () => {
        const html = read('pages/hospitals.html');
        ['correction-form', 'correction-facility', 'correction-field', 'correction-value', 'correction-source', 'correction-contact', 'correction-website', 'correction-status'].forEach((id) => {
            assert.ok(html.includes('id="' + id + '"'), id);
        });
        assert.match(html, /id="correction-section"[^>]*hidden/);
        assert.match(html, /class="correction-trap" aria-hidden="true"/);
        assert.match(html, /id="correction-status"[^>]*aria-live="polite"/);
        const order = ['auth-mode.js', 'api.js', 'facility-utils.js', 'facility-corrections.js', 'facility-corrections-ui.js'].map((f) => html.indexOf('assets/js/' + f));
        assert.ok(order.every((i) => i !== -1));
        assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
    });

    it('every form field has a visible label', () => {
        const html = read('pages/hospitals.html');
        ['correction-facility', 'correction-field', 'correction-value', 'correction-source', 'correction-contact'].forEach((id) => {
            assert.ok(html.includes('for="' + id + '"'), id);
        });
    });

    it('facility cards offer a "Suggest a correction" button', () => {
        const js = read('assets/js/hospitals.js');
        assert.match(js, /class="btn-correct"/);
        assert.match(js, /relief:facilities-loaded/);
    });

    it('admin panel has the moderation view and loads the scripts', () => {
        const html = read('pages/admin-panel.html');
        ['correction-moderation', 'correction-queue', 'correction-log', 'correction-patch', 'moderator-name', 'correction-status-filter', 'moderation-demo-note'].forEach((id) => {
            assert.ok(html.includes('id="' + id + '"'), id);
        });
        assert.ok(html.indexOf('facility-corrections.js') < html.indexOf('facility-corrections-ui.js'));
        assert.ok(html.indexOf('assets/js/api.js') < html.indexOf('facility-corrections.js'));
    });

    it('the UI file builds moderator lists with textContent, never innerHTML', () => {
        const code = stripComments(read('assets/js/facility-corrections-ui.js'));
        assert.doesNotMatch(code, /insertAdjacentHTML|outerHTML|document\.write/);
        const inner = code.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
        inner.forEach((line) => assert.match(line, /=\s*''\s*;/, 'only clearing is allowed: ' + line));
    });

    it('service worker cache version moved on because hospitals.js and hospitals.css changed', () => {
        assert.doesNotMatch(read('sw.js'), /CACHE_VERSION = 'v1'/);
    });
});
