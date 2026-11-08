/**
 * Tests for Issue #18: accessible appointment request workflow.
 * Covers validation, the stored record, duplicates, storage failures and the
 * removal of patient-data logging and the fake video call from the page script.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    validateRequest,
    buildRequest,
    isDuplicate,
    normalizePhone,
    loadRequests,
    saveRequest,
    STORAGE_KEY
} = require('../assets/js/appointment-request.js');

// Fixed clock: Wednesday 14 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0, 0);

function validInput(overrides) {
    return Object.assign({
        doctor: { id: 3, name: 'Dr. Asha Rao', specialty: 'Cardiology', location: 'Pune', rating: 4.5, reviews: 120, image: 'x.jpg' },
        date: '2026-10-16',
        timeWindow: 'morning',
        name: 'Ravi Kumar',
        email: 'Ravi@Example.com',
        phone: '+91 98765 43210',
        notes: 'Chest pain on stairs',
        consent: true
    }, overrides);
}

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        data
    };
}

describe('validateRequest', () => {
    it('accepts a complete request', () => {
        const r = validateRequest(validInput(), { now: NOW });
        assert.strictEqual(r.valid, true);
        assert.deepStrictEqual(r.errors, {});
        assert.strictEqual(r.firstInvalid, null);
    });

    it('reports every missing field and the first one in page order', () => {
        const r = validateRequest({}, { now: NOW });
        assert.strictEqual(r.valid, false);
        ['doctor', 'date', 'timeWindow', 'name', 'email', 'phone', 'consent'].forEach((k) => {
            assert.ok(r.errors[k], 'missing error for ' + k);
        });
        assert.strictEqual(r.firstInvalid, 'doctor');
    });

    it('rejects a missing doctor', () => {
        const r = validateRequest(validInput({ doctor: null }), { now: NOW });
        assert.strictEqual(r.firstInvalid, 'doctor');
        assert.match(r.errors.doctor, /doctor/i);
    });

    it('rejects a doctor record without an id or name', () => {
        assert.ok(validateRequest(validInput({ doctor: { name: 'Dr X' } }), { now: NOW }).errors.doctor);
        assert.ok(validateRequest(validInput({ doctor: { id: 1 } }), { now: NOW }).errors.doctor);
    });

    it('rejects past dates but allows today', () => {
        const past = validateRequest(validInput({ date: '2026-10-13' }), { now: NOW });
        assert.strictEqual(past.firstInvalid, 'date');
        assert.match(past.errors.date, /past/i);
        const today = validateRequest(validInput({ date: '2026-10-14', timeWindow: 'afternoon' }), { now: NOW });
        assert.strictEqual(today.valid, true);
    });

    it('rejects impossible and malformed dates', () => {
        ['2026-02-30', '2026-13-01', '14/10/2026', 'tomorrow', ''].forEach((d) => {
            assert.ok(validateRequest(validInput({ date: d }), { now: NOW }).errors.date, d);
        });
    });

    it('rejects dates too far ahead', () => {
        assert.ok(validateRequest(validInput({ date: '2027-03-01' }), { now: NOW }).errors.date);
    });

    it('rejects a time window that already ended today', () => {
        const late = new Date(2026, 9, 14, 13, 0, 0);
        const r = validateRequest(validInput({ date: '2026-10-14', timeWindow: 'morning' }), { now: late });
        assert.ok(r.errors.timeWindow);
        assert.strictEqual(validateRequest(validInput({ date: '2026-10-15', timeWindow: 'morning' }), { now: late }).valid, true);
    });

    it('rejects an unknown time window, including inherited property names', () => {
        assert.ok(validateRequest(validInput({ timeWindow: '10:30' }), { now: NOW }).errors.timeWindow);
        assert.ok(validateRequest(validInput({ timeWindow: 'toString' }), { now: NOW }).errors.timeWindow);
    });

    it('validates name and email', () => {
        assert.ok(validateRequest(validInput({ name: ' ' }), { now: NOW }).errors.name);
        assert.ok(validateRequest(validInput({ name: 'A' }), { now: NOW }).errors.name);
        assert.ok(validateRequest(validInput({ email: 'not-an-email' }), { now: NOW }).errors.email);
        assert.ok(validateRequest(validInput({ email: 'a@b' }), { now: NOW }).errors.email);
    });

    it('requires consent to be exactly true', () => {
        assert.ok(validateRequest(validInput({ consent: false }), { now: NOW }).errors.consent);
        assert.ok(validateRequest(validInput({ consent: 'yes' }), { now: NOW }).errors.consent);
        assert.ok(validateRequest(validInput({ consent: undefined }), { now: NOW }).errors.consent);
    });

    it('limits the length of notes', () => {
        assert.ok(validateRequest(validInput({ notes: 'x'.repeat(501) }), { now: NOW }).errors.notes);
        assert.strictEqual(validateRequest(validInput({ notes: 'x'.repeat(500) }), { now: NOW }).valid, true);
        assert.strictEqual(validateRequest(validInput({ notes: '' }), { now: NOW }).valid, true);
    });

    it('does not throw on null or non-string input', () => {
        assert.strictEqual(validateRequest(null, { now: NOW }).valid, false);
        assert.strictEqual(validateRequest(validInput({ name: 5, email: {}, phone: [], date: 20261016 }), { now: NOW }).valid, false);
    });
});

describe('phone numbers', () => {
    it('accepts +91 formats with spaces, dashes and brackets', () => {
        ['+91 98765 43210', '+919876543210', '+91-98765-43210', '+91 (98765) 43210', '098765 43210', '9876543210', '91 9876543210']
            .forEach((p) => assert.strictEqual(normalizePhone(p), '+919876543210', p));
    });

    it('accepts other international numbers', () => {
        assert.strictEqual(normalizePhone('+1 415 555 2671'), '+14155552671');
    });

    it('rejects bad numbers', () => {
        ['', '12345', '+91 12345 67890', '5876543210', 'call me', '+91 98765 4321', '98765-43210-1', '+0123456789']
            .forEach((p) => assert.strictEqual(normalizePhone(p), null, p));
    });

    it('is reported through validateRequest', () => {
        const r = validateRequest(validInput({ phone: '12345' }), { now: NOW });
        assert.strictEqual(r.firstInvalid, 'phone');
    });
});

describe('buildRequest', () => {
    it('always starts as submitted, never confirmed', () => {
        const req = buildRequest(validInput(), { now: NOW, id: 'req-1' });
        assert.strictEqual(req.status, 'submitted');
        assert.deepStrictEqual(req.statusHistory, [{ status: 'submitted', at: NOW.toISOString(), by: 'patient' }]);
    });

    it('keeps only the fields that are needed', () => {
        const req = buildRequest(validInput(), { now: NOW, id: 'req-1' });
        assert.deepStrictEqual(Object.keys(req).sort(), [
            'consentGiven', 'createdAt', 'doctorId', 'doctorName', 'id', 'notes', 'patientEmail',
            'patientName', 'patientPhone', 'preferredDate', 'preferredWindow', 'specialty', 'status', 'statusHistory'
        ]);
        const text = JSON.stringify(req);
        assert.ok(!/videoUrl|image|rating|reviews|location/.test(text));
    });

    it('normalises email and phone and trims text', () => {
        const req = buildRequest(validInput({ name: '  Ravi Kumar ', notes: '  hi  ' }), { now: NOW, id: 'req-1' });
        assert.strictEqual(req.patientEmail, 'ravi@example.com');
        assert.strictEqual(req.patientPhone, '+919876543210');
        assert.strictEqual(req.patientName, 'Ravi Kumar');
        assert.strictEqual(req.notes, 'hi');
        assert.strictEqual(req.consentGiven, true);
        assert.strictEqual(req.createdAt, NOW.toISOString());
    });

    it('omits notes when empty', () => {
        const req = buildRequest(validInput({ notes: '   ' }), { now: NOW, id: 'req-1' });
        assert.ok(!('notes' in req));
    });

    it('throws for invalid input instead of building a record', () => {
        assert.throws(() => buildRequest(validInput({ consent: false }), { now: NOW }), /consent/);
    });

    it('generates distinct ids', () => {
        const a = buildRequest(validInput(), { now: NOW });
        const b = buildRequest(validInput(), { now: NOW });
        assert.notStrictEqual(a.id, b.id);
    });

    it('never writes patient data to the console', () => {
        const calls = [];
        const originals = {};
        ['log', 'info', 'warn', 'error', 'debug'].forEach((m) => {
            originals[m] = console[m];
            console[m] = (...args) => calls.push(args);
        });
        try {
            const req = buildRequest(validInput(), { now: NOW, id: 'req-1' });
            saveRequest(memoryStorage(), req);
            validateRequest(validInput({ email: 'bad' }), { now: NOW });
        } finally {
            Object.keys(originals).forEach((m) => { console[m] = originals[m]; });
        }
        assert.deepStrictEqual(calls, []);
    });
});

describe('isDuplicate', () => {
    const base = () => buildRequest(validInput(), { now: NOW, id: 'req-1' });

    it('detects the same doctor, date, window and email', () => {
        assert.strictEqual(isDuplicate([base()], buildRequest(validInput(), { now: NOW, id: 'req-2' })), true);
    });

    it('detects the same phone with a different email', () => {
        const other = buildRequest(validInput({ email: 'other@example.com', phone: '9876543210' }), { now: NOW, id: 'req-2' });
        assert.strictEqual(isDuplicate([base()], other), true);
    });

    it('is not a duplicate when doctor, date or window differs', () => {
        const existing = [base()];
        assert.strictEqual(isDuplicate(existing, buildRequest(validInput({ doctor: { id: 4, name: 'Dr. B' } }), { now: NOW, id: 'r' })), false);
        assert.strictEqual(isDuplicate(existing, buildRequest(validInput({ date: '2026-10-17' }), { now: NOW, id: 'r' })), false);
        assert.strictEqual(isDuplicate(existing, buildRequest(validInput({ timeWindow: 'evening' }), { now: NOW, id: 'r' })), false);
    });

    it('is not a duplicate for a different patient', () => {
        const other = buildRequest(validInput({ email: 'x@example.com', phone: '+91 91234 56789' }), { now: NOW, id: 'r' });
        assert.strictEqual(isDuplicate([base()], other), false);
    });

    it('ignores non-open or malformed stored entries and bad arguments', () => {
        const cancelled = Object.assign(base(), { status: 'cancelled' });
        assert.strictEqual(isDuplicate([cancelled, null, 'x'], buildRequest(validInput(), { now: NOW, id: 'r' })), false);
        assert.strictEqual(isDuplicate(null, base()), false);
        assert.strictEqual(isDuplicate([base()], null), false);
    });
});

describe('storage', () => {
    it('saves a request and reads it back', () => {
        const storage = memoryStorage();
        const req = buildRequest(validInput(), { now: NOW, id: 'req-1' });
        assert.deepStrictEqual(saveRequest(storage, req), { ok: true });
        assert.strictEqual(loadRequests(storage).length, 1);
        assert.strictEqual(JSON.parse(storage.data[STORAGE_KEY])[0].status, 'submitted');
    });

    it('blocks a second identical save (double submit)', () => {
        const storage = memoryStorage();
        saveRequest(storage, buildRequest(validInput(), { now: NOW, id: 'req-1' }));
        const second = saveRequest(storage, buildRequest(validInput(), { now: NOW, id: 'req-2' }));
        assert.deepStrictEqual(second, { ok: false, reason: 'duplicate' });
        assert.strictEqual(loadRequests(storage).length, 1);
    });

    it('reports a full storage instead of throwing', () => {
        const storage = memoryStorage();
        storage.setItem = () => { throw new Error('QuotaExceededError'); };
        const result = saveRequest(storage, buildRequest(validInput(), { now: NOW, id: 'req-1' }));
        assert.deepStrictEqual(result, { ok: false, reason: 'storage' });
    });

    it('reports blocked storage (getItem throws) instead of throwing', () => {
        const storage = {
            getItem: () => { throw new Error('SecurityError'); },
            setItem: () => { throw new Error('SecurityError'); }
        };
        assert.deepStrictEqual(loadRequests(storage), []);
        assert.deepStrictEqual(saveRequest(storage, buildRequest(validInput(), { now: NOW, id: 'req-1' })), { ok: false, reason: 'storage' });
    });

    it('recovers from corrupt stored data', () => {
        const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
        assert.deepStrictEqual(loadRequests(storage), []);
        assert.deepStrictEqual(saveRequest(storage, buildRequest(validInput(), { now: NOW, id: 'req-1' })), { ok: true });
        assert.strictEqual(loadRequests(memoryStorage({ [STORAGE_KEY]: '{"a":1}' })).length, 0);
    });
});

describe('page wiring', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const script = read('assets/js/appointments.js');
    const html = read('pages/appointments.html');

    it('no longer logs data, fakes a video room or calls Daily', () => {
        assert.ok(!/console\.\w+\(/.test(script), 'no console calls');
        assert.ok(!/DailyIframe/.test(script));
        assert.ok(!/videoUrl|your-video-service/.test(script));
        assert.ok(!/\balert\(/.test(script), 'errors are inline, not alert()');
    });

    it('keeps nothing in the URL', () => {
        assert.ok(!/location\.(search|hash)|URLSearchParams|location\.href\s*=/.test(script));
    });

    it('offers time windows, not made-up slots', () => {
        assert.ok(!/generateTimeSlots|time-slot/.test(script));
        ['morning', 'afternoon', 'evening'].forEach((w) => assert.ok(html.includes('value="' + w + '"'), w));
        assert.match(html, /provider confirms/i);
    });

    it('has a consent checkbox that links to the privacy policy', () => {
        assert.match(html, /id="patient-consent"[^>]*type="checkbox"|type="checkbox"[^>]*id="patient-consent"/);
        assert.ok(html.includes('href="../pages/privacy-policy.html"'));
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'pages/privacy-policy.html')));
    });

    it('wires each field to an error message with aria-describedby', () => {
        ['preferred-date', 'patient-name', 'patient-email', 'patient-phone', 'patient-notes', 'patient-consent'].forEach((id) => {
            assert.match(html, new RegExp('id="' + id + '"[^>]*aria-describedby="[^"]*' + id + '-error'), id);
            assert.ok(html.includes('id="' + id + '-error"'), id + ' error element');
        });
        assert.ok(html.includes('id="time-window-error"'));
        // aria-invalid and the error summary come from the shared helper (see form-validation.test.js).
        const helper = fs.readFileSync(path.join(__dirname, '..', 'assets/js/form-errors.js'), 'utf8');
        assert.ok(helper.includes("setAttribute('aria-invalid', 'true')"));
        assert.match(script, /FormErrors\.applyErrors/);
        assert.match(script, /\.focus\(\)/);
    });

    it('loads the request module before the page script', () => {
        assert.ok(html.indexOf('appointment-request.js') > -1);
        assert.ok(html.indexOf('appointment-request.js') < html.indexOf('assets/js/appointments.js'));
    });

    it('blocks double submit and words success as not confirmed', () => {
        assert.match(script, /if \(sending\) return/);
        assert.match(script, /submitButton\.disabled = value/);
        assert.match(script, /Request submitted, not yet confirmed/);
        assert.ok(!/booked successfully|Appointment confirmed/i.test(script + html));
    });
});
