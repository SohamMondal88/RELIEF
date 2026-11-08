/**
 * Tests for health events: date/time validation, filters, past-event archiving,
 * the confirmed vs unverified rule, the organiser submission and moderation
 * workflow, the demo store, and the page wiring.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const H = require('../assets/js/health-events.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = Date.parse('2026-10-28T06:00:00Z'); // 11:30 IST
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function event(overrides) {
    return Object.assign({
        id: 'e1',
        title: 'Free Health Camp',
        type: 'health-camp',
        startsAt: '2026-11-08T09:00:00+05:30',
        endsAt: '2026-11-08T16:00:00+05:30',
        district: 'Bankura',
        venue: 'School grounds, Chhatna',
        organiser: 'Block PHC',
        services: ['BP check'],
        eligibility: 'Everyone',
        contactPhone: '+91 3242 250 201',
        status: 'confirmed',
        lastUpdated: '2026-10-25T11:30:00+05:30'
    }, overrides);
}

function submission(overrides) {
    return Object.assign({
        title: 'Free Eye Camp',
        type: 'screening',
        startDate: '10-11-2026',
        startTime: '09:00',
        endDate: '',
        endTime: '15:00',
        district: 'Purulia',
        venue: 'Community hall, Raghunathpur',
        organiser: 'Lions Club Purulia',
        services: 'Vision test, Cataract screening',
        eligibility: 'Everyone',
        contactPhone: '+91 98300 12345',
        contactEmail: '',
        sourceUrl: '',
        website: ''
    }, overrides);
}

function memoryStorage() {
    const data = {};
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        data
    };
}

describe('dates and times', () => {
    it('accepts real calendar dates only', () => {
        assert.strictEqual(H.isValidDate('08-11-2026'), true);
        assert.strictEqual(H.isValidDate('29-02-2028'), true);
        assert.strictEqual(H.isValidDate('29-02-2027'), false);
        assert.strictEqual(H.isValidDate('31-04-2026'), false);
        assert.strictEqual(H.isValidDate('08-13-2026'), false);
        assert.strictEqual(H.isValidDate('2026-11-08'), false);
        assert.strictEqual(H.isValidDate(''), false);
    });

    it('accepts 24 hour HH:MM times only', () => {
        assert.strictEqual(H.isValidTime('09:30'), true);
        assert.strictEqual(H.isValidTime('23:59'), true);
        assert.strictEqual(H.isValidTime('24:00'), false);
        assert.strictEqual(H.isValidTime('9:30'), false);
        assert.strictEqual(H.isValidTime('09:60'), false);
    });

    it('reads form date and time as India Standard Time', () => {
        const iso = H.toIstIso('08-11-2026', '09:00');
        assert.strictEqual(iso, '2026-11-08T09:00:00+05:30');
        assert.strictEqual(Date.parse(iso), Date.parse('2026-11-08T03:30:00Z'));
        assert.strictEqual(H.toIstIso('30-02-2026', '09:00'), null);
    });

    it('only parses instants with an explicit offset', () => {
        assert.ok(isFinite(H.parseInstant('2026-11-08T09:00:00+05:30')));
        assert.ok(isFinite(H.parseInstant('2026-11-08T03:30:00Z')));
        assert.ok(Number.isNaN(H.parseInstant('2026-11-08T09:00:00')));
        assert.ok(Number.isNaN(H.parseInstant('2026-11-08')));
        assert.ok(Number.isNaN(H.parseInstant('2026-02-30T09:00:00Z')));
        assert.ok(Number.isNaN(H.parseInstant(12345)));
    });

    it('gives the IST calendar date of an instant', () => {
        assert.strictEqual(H.istDate(Date.parse('2026-11-07T20:00:00Z')), '2026-11-08');
    });
});

describe('past, ongoing and upcoming', () => {
    it('marks events by their end time', () => {
        assert.strictEqual(H.timeState(event(), NOW), 'upcoming');
        assert.strictEqual(H.timeState(event({ startsAt: '2026-10-28T09:00:00+05:30', endsAt: '2026-10-28T16:00:00+05:30' }), NOW), 'ongoing');
        assert.strictEqual(H.timeState(event({ startsAt: '2026-10-12T09:00:00+05:30', endsAt: '2026-10-12T15:00:00+05:30' }), NOW), 'past');
    });

    it('treats an event without an end as finished 8 hours after it starts', () => {
        const e = event({ startsAt: '2026-10-28T05:00:00+05:30', endsAt: null });
        assert.strictEqual(H.timeState(e, NOW), 'ongoing');
        assert.strictEqual(H.timeState(e, NOW + 2 * HOUR), 'past');
    });

    it('archives past events separately, most recent first', () => {
        const list = H.normalizeEvents([
            event({ id: 'a', startsAt: '2026-11-20T09:00:00+05:30', endsAt: '2026-11-20T12:00:00+05:30' }),
            event({ id: 'b' }),
            event({ id: 'old', startsAt: '2026-09-01T09:00:00+05:30', endsAt: '2026-09-01T12:00:00+05:30' }),
            event({ id: 'recent', startsAt: '2026-10-20T09:00:00+05:30', endsAt: '2026-10-20T12:00:00+05:30' })
        ]);
        const parts = H.partitionByTime(list, NOW);
        assert.deepStrictEqual(parts.current.map((e) => e.id), ['b', 'a']);
        assert.deepStrictEqual(parts.past.map((e) => e.id), ['recent', 'old']);
    });
});

describe('normalizing records', () => {
    it('keeps the last-updated timestamp', () => {
        assert.strictEqual(H.normalizeEvent(event()).lastUpdated, '2026-10-25T11:30:00+05:30');
        assert.strictEqual(H.normalizeEvent(event({ lastUpdated: 'yesterday' })).lastUpdated, null);
    });

    it('drops records with a missing or invalid start, or an end before the start', () => {
        assert.strictEqual(H.normalizeEvent(event({ startsAt: 'soon' })), null);
        assert.strictEqual(H.normalizeEvent(event({ endsAt: '2026-11-08T08:00:00+05:30' })), null);
        assert.strictEqual(H.normalizeEvent(event({ endsAt: 'later' })), null);
        assert.strictEqual(H.normalizeEvent(event({ title: '   ' })), null);
    });

    it('is confirmed only when the status says exactly "confirmed"', () => {
        assert.strictEqual(H.normalizeEvent(event()).status, 'confirmed');
        ['Confirmed', 'verified', 'approved', '', undefined, true].forEach((status) => {
            assert.strictEqual(H.normalizeEvent(event({ status })).status, 'pending', String(status));
        });
    });

    it('strips HTML and refuses non-http source links', () => {
        const e = H.normalizeEvent(event({ title: '<img src=x onerror=alert(1)>Camp', sourceUrl: 'javascript:alert(1)' }));
        assert.strictEqual(e.title, 'Camp');
        assert.strictEqual(e.sourceUrl, '');
    });

    it('drops duplicate ids', () => {
        assert.strictEqual(H.normalizeEvents([event(), event()]).length, 1);
    });
});

describe('filters', () => {
    const list = H.normalizeEvents([
        event({ id: 'bankura' }),
        event({ id: 'purulia', district: 'Purulia', venue: 'Anganwadi, Raghunathpur', type: 'vaccination', startsAt: '2026-11-12T10:00:00+05:30', endsAt: '2026-11-14T15:00:00+05:30' }),
        event({ id: 'unverified', status: 'pending', district: 'Bankura' }),
        event({ id: 'rejected', status: 'rejected', district: 'Bankura' })
    ]);
    const ids = (f) => H.filterEvents(list, f).map((e) => e.id).sort();

    it('hides unverified submissions unless asked, and rejected ones always', () => {
        assert.deepStrictEqual(ids({}), ['bankura', 'purulia']);
        assert.deepStrictEqual(ids({ includeUnverified: true }), ['bankura', 'purulia', 'unverified']);
    });

    it('filters by location in district, venue or title, ignoring case', () => {
        assert.deepStrictEqual(ids({ location: 'bankura' }), ['bankura']);
        assert.deepStrictEqual(ids({ location: 'RAGHUNATHPUR' }), ['purulia']);
    });

    it('filters by type', () => {
        assert.deepStrictEqual(ids({ type: 'vaccination' }), ['purulia']);
        assert.deepStrictEqual(ids({ type: 'nonsense' }), ['bankura', 'purulia']);
    });

    it('keeps events that overlap the date range', () => {
        assert.deepStrictEqual(ids({ from: '13-11-2026', to: '13-11-2026' }), ['purulia']);
        assert.deepStrictEqual(ids({ from: '08-11-2026', to: '08-11-2026' }), ['bankura']);
        assert.deepStrictEqual(ids({ from: '15-11-2026' }), []);
        assert.deepStrictEqual(ids({ to: '07-11-2026' }), []);
    });

    it('validates the date filter', () => {
        assert.strictEqual(H.validateFilters({ from: '10-11-2026', to: '09-11-2026' }).valid, false);
        assert.ok(H.validateFilters({ from: '10-11-2026', to: '09-11-2026' }).errors.to);
        assert.ok(H.validateFilters({ from: '30-02-2026' }).errors.from);
        assert.strictEqual(H.validateFilters({ from: '10-11-2026', to: '10-11-2026' }).valid, true);
    });

    it('lists distinct districts for suggestions', () => {
        assert.deepStrictEqual(H.districts(list), ['Bankura', 'Purulia']);
    });
});

describe('organiser submissions', () => {
    const check = (o) => H.validateSubmission(submission(o), { now: NOW });

    it('accepts a complete submission and stores IST times', () => {
        const r = check();
        assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
        assert.strictEqual(r.clean.startsAt, '2026-11-10T09:00:00+05:30');
        assert.strictEqual(r.clean.endsAt, '2026-11-10T15:00:00+05:30');
        assert.deepStrictEqual(r.clean.services, ['Vision test', 'Cataract screening']);
    });

    it('rejects invalid dates and times', () => {
        assert.ok(check({ startDate: '30-02-2026' }).errors.startDate);
        assert.ok(check({ startDate: '' }).errors.startDate);
        assert.ok(check({ startTime: '25:00' }).errors.startTime);
        assert.ok(check({ endTime: '' }).errors.endTime);
        assert.ok(check({ endDate: '01-13-2026' }).errors.endDate);
    });

    it('rejects an event in the past, too far ahead, ending before it starts, or lasting over 30 days', () => {
        assert.ok(check({ startDate: '27-10-2026' }).errors.startDate);
        assert.ok(check({ startDate: '28-10-2026', startTime: '11:00' }).errors.startDate);
        assert.ok(check({ startDate: '01-12-2027' }).errors.startDate);
        assert.ok(check({ endTime: '08:00' }).errors.endTime);
        assert.strictEqual(check({ endDate: '10-12-2026', endTime: '09:00' }).valid, true);
        assert.ok(check({ endDate: '10-12-2026' }).errors.endDate);
        assert.strictEqual(check({ endDate: '12-11-2026' }).valid, true);
    });

    it('needs a phone or an email', () => {
        assert.ok(check({ contactPhone: '', contactEmail: '' }).errors.contactPhone);
        assert.strictEqual(check({ contactPhone: '', contactEmail: 'camp@example.org' }).valid, true);
        assert.ok(check({ contactPhone: 'call me' }).errors.contactPhone);
        assert.ok(check({ contactEmail: 'not-an-email' }).errors.contactEmail);
    });

    it('requires the main fields', () => {
        const r = check({ title: '', type: 'party', district: '', venue: '', organiser: '', services: '', eligibility: '' });
        ['title', 'type', 'district', 'venue', 'organiser', 'services', 'eligibility'].forEach((k) => assert.ok(r.errors[k], k));
    });

    it('treats the honeypot as spam', () => {
        assert.strictEqual(check({ website: 'http://spam.example' }).spam, true);
    });

    it('always builds a pending submission, whatever the input claims', () => {
        const r = H.validateSubmission(submission({ status: 'confirmed', verifiedBy: 'me' }), { now: NOW });
        assert.strictEqual('status' in r.clean, false);
        const s = H.buildSubmission(Object.assign({}, r.clean, { status: 'confirmed' }), { now: NOW, id: 'x' });
        assert.strictEqual(s.status, 'pending');
        assert.strictEqual(s.verifiedBy, null);
        assert.strictEqual(s.lastUpdated, new Date(NOW).toISOString());
        assert.strictEqual(H.isConfirmed(H.normalizeEvent(s)), false);
    });

    it('blocks duplicates and rapid repeats', () => {
        const clean = check().clean;
        const fp = H.fingerprint(clean);
        assert.strictEqual(H.checkRateLimit([{ at: NOW - DAY, fingerprint: fp }], NOW, clean).reason, 'duplicate');
        assert.strictEqual(H.checkRateLimit([{ at: NOW - 1000, fingerprint: 'other' }], NOW, clean).reason, 'too-fast');
        const five = [1, 2, 3, 4, 5].map((i) => ({ at: NOW - i * HOUR, fingerprint: 'x' + i }));
        assert.strictEqual(H.checkRateLimit(five, NOW, clean).reason, 'daily');
        assert.strictEqual(H.checkRateLimit([], NOW, clean).allowed, true);
    });
});

describe('moderation', () => {
    const pending = () => H.buildSubmission(H.validateSubmission(submission(), { now: NOW }).clean, { now: NOW, id: 's1' });

    it('confirms only with a named moderator and evidence', () => {
        assert.ok(H.decide(pending(), { decision: 'approve', actor: '', evidence: 'Called the organiser' }).errors.actor);
        assert.ok(H.decide(pending(), { decision: 'approve', actor: 'Asha', evidence: 'ok' }).errors.evidence);
        const r = H.decide(pending(), { decision: 'approve', actor: 'Asha', evidence: 'Called the organiser on 28 Oct' }, { now: NOW + HOUR });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.record.status, 'confirmed');
        assert.strictEqual(r.record.verifiedBy, 'Asha');
        assert.strictEqual(r.record.lastUpdated, new Date(NOW + HOUR).toISOString());
        assert.strictEqual(r.record.history.length, 2);
    });

    it('rejects only with a reason, and never confirms', () => {
        assert.ok(H.decide(pending(), { decision: 'reject', actor: 'Asha', reason: '' }).errors.reason);
        const r = H.decide(pending(), { decision: 'reject', actor: 'Asha', reason: 'Organiser says cancelled' });
        assert.strictEqual(r.record.status, 'rejected');
        assert.strictEqual(r.record.verifiedBy, null);
    });

    it('makes decisions final and leaves the input untouched', () => {
        const p = pending();
        const r = H.decide(p, { decision: 'approve', actor: 'Asha', evidence: 'Called the organiser' });
        assert.strictEqual(p.status, 'pending');
        assert.strictEqual(p.history.length, 1);
        assert.ok(H.decide(r.record, { decision: 'reject', actor: 'Asha', reason: 'changed mind' }).errors.form);
    });
});

describe('store', () => {
    const SEED = [event({ id: 'seed-1' })];

    it('demo mode: submit, list, confirm, and publish', async () => {
        const storage = memoryStorage();
        let t = NOW;
        const store = H.createStore({ storage, demo: true, now: () => t, idFn: () => 'demo-1' });
        const sent = await store.submit(submission());
        assert.strictEqual(sent.ok, true, JSON.stringify(sent));
        assert.strictEqual(sent.demo, true);
        assert.strictEqual(sent.submission.status, 'pending');

        let pub = await store.publicEvents(SEED);
        const mine = pub.events.find((e) => e.id === 'demo-1');
        assert.strictEqual(mine.status, 'pending');
        assert.strictEqual(H.filterEvents(pub.events, {}).some((e) => e.id === 'demo-1'), false, 'unverified is not listed as confirmed');

        const queue = await store.list({ status: 'pending' });
        assert.deepStrictEqual(queue.items.map((r) => r.id), ['demo-1']);

        t += HOUR;
        const done = await store.review('demo-1', { decision: 'approve', actor: 'Asha', evidence: 'Called the organiser' });
        assert.strictEqual(done.ok, true);
        pub = await store.publicEvents(SEED);
        assert.strictEqual(H.filterEvents(pub.events, {}).some((e) => e.id === 'demo-1'), true);
    });

    it('demo mode: rejected submissions are not published', async () => {
        const storage = memoryStorage();
        const store = H.createStore({ storage, demo: true, now: () => NOW, idFn: () => 'demo-2' });
        await store.submit(submission());
        await store.review('demo-2', { decision: 'reject', actor: 'Asha', reason: 'Not a real event' });
        const pub = await store.publicEvents([]);
        assert.strictEqual(pub.events.length, 0);
    });

    it('refuses a duplicate submission', async () => {
        const store = H.createStore({ storage: memoryStorage(), demo: true, now: () => NOW });
        assert.strictEqual((await store.submit(submission())).ok, true);
        assert.strictEqual((await store.submit(submission())).kind, 'duplicate');
    });

    it('outside demo mode with no backend: nothing is stored', async () => {
        const storage = memoryStorage();
        const store = H.createStore({ storage, demo: false, now: () => NOW });
        const r = await store.submit(submission());
        assert.strictEqual(r.kind, 'unavailable');
        assert.strictEqual(storage.getItem(H.DEMO_QUEUE_KEY), null);
        const pub = await store.publicEvents(SEED);
        assert.strictEqual(pub.mode, 'static');
        assert.deepStrictEqual(pub.events.map((e) => e.id), ['seed-1']);
    });

    it('sends only cleaned fields to the backend, never a status', async () => {
        let sent = null;
        const api = { submitHealthEvent: async (body) => { sent = body; return { id: 'srv-1', status: 'pending' }; } };
        const store = H.createStore({ api, storage: memoryStorage(), demo: false, now: () => NOW });
        const r = await store.submit(submission({ status: 'confirmed' }));
        assert.strictEqual(r.ok, true);
        assert.strictEqual('status' in sent, false);
        assert.strictEqual('website' in sent, false);
        assert.strictEqual(sent.startsAt, '2026-11-10T09:00:00+05:30');
    });

    it('normalizes the backend list, so an odd status is never shown as confirmed', async () => {
        const api = { listHealthEvents: async () => ({ events: [event({ id: 's', status: 'CONFIRMED' })] }) };
        const store = H.createStore({ api, demo: false });
        const pub = await store.publicEvents([]);
        assert.strictEqual(pub.events[0].status, 'pending');
    });

    it('reports moderator-only errors from the backend', async () => {
        const api = { listHealthEventSubmissions: async () => { const e = new Error('no'); e.code = 'forbidden'; throw e; } };
        const store = H.createStore({ api, demo: false });
        assert.strictEqual((await store.list({ status: 'pending' })).kind, 'forbidden');
    });
});

describe('data file and page wiring', () => {
    it('every event in the data file is valid, sample-marked and has a last-updated time', () => {
        const data = JSON.parse(read('assets/data/health-events.json'));
        assert.ok(Array.isArray(data.events) && data.events.length > 0);
        const list = H.normalizeEvents(data.events);
        assert.strictEqual(list.length, data.events.length, 'no record should be dropped');
        list.forEach((e) => {
            assert.ok(e.lastUpdated, e.id + ' lastUpdated');
            assert.strictEqual(e.sample, true, e.id + ' is a sample');
        });
    });

    it('the page loads its scripts in order and has loading and empty states', () => {
        const html = read('pages/health-events.html');
        const order = ['assets/js/auth-mode.js', 'assets/js/api.js', 'assets/js/health-events.js', 'assets/js/health-events-ui.js']
            .map((s) => html.indexOf(s));
        order.forEach((i) => assert.ok(i !== -1));
        assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
        ['events-loading', 'events-empty', 'events-error', 'events-past', 'event-submit-form', 'main-content'].forEach((id) => {
            assert.ok(html.includes('id="' + id + '"'), id);
        });
    });

    it('the admin panel has the moderation queue', () => {
        const html = read('pages/admin-panel.html');
        assert.ok(html.includes('id="event-moderation"'));
        assert.ok(html.includes('assets/js/health-events-ui.js'));
    });

    it('the UI never writes event text as HTML', () => {
        const src = read('assets/js/health-events-ui.js');
        assert.strictEqual(/innerHTML|outerHTML|insertAdjacentHTML/.test(src), false);
    });

    it('ReliefAPI defines and exports the health event endpoints', () => {
        const src = read('assets/js/api.js');
        const exported = src.slice(src.lastIndexOf('return {'));
        ['listHealthEvents', 'submitHealthEvent', 'listHealthEventSubmissions', 'reviewHealthEventSubmission'].forEach((name) => {
            assert.ok(src.includes('const ' + name + ' = '), name + ' defined');
            assert.ok(new RegExp('\\b' + name + '\\b').test(exported), name + ' exported');
        });
    });
});
