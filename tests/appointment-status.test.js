/**
 * Appointment request status tracking and cancellation (Issue #62).
 *
 * node --test tests/appointment-status.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../assets/js/appointment-status.js');
const Request = require('../assets/js/appointment-request.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date(2026, 9, 27, 10, 0, 0);
const input = (extra) => Object.assign({
  doctor: { id: 'doc-1', name: 'Dr. Example', specialty: 'General Physician' },
  date: '2026-10-30', timeWindow: 'morning', name: 'Asha Example', email: 'asha@example.org',
  phone: '+91 98000 00000', notes: 'Private note about my health', consent: true
}, extra);
const make = (id, extra) => Object.assign(Request.buildRequest(input(), { now: NOW, id }), extra);

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

const EXPECTED = {
  patient: { submitted: ['cancelled'], under_review: ['cancelled'], confirmed: ['cancelled'], declined: [], cancelled: [] },
  provider: {
    submitted: ['under_review', 'declined'],
    under_review: ['confirmed', 'declined', 'cancelled'],
    confirmed: ['cancelled'],
    declined: [], cancelled: []
  }
};

test('[transitions] every combination of status, target and actor matches the table', () => {
  ['patient', 'provider'].forEach((actor) => {
    S.STATUSES.forEach((from) => {
      S.STATUSES.forEach((to) => {
        const allowed = EXPECTED[actor][from].includes(to);
        assert.strictEqual(S.checkTransition(from, to, actor).ok, allowed, actor + ': ' + from + ' -> ' + to);
      });
    });
  });
});

test('[transitions] a patient can never confirm, review or decline', () => {
  S.STATUSES.forEach((from) => {
    ['confirmed', 'under_review', 'declined', 'submitted'].forEach((to) => {
      assert.strictEqual(S.checkTransition(from, to, 'patient').ok, false, from + ' -> ' + to);
    });
  });
  assert.strictEqual(S.checkTransition('submitted', 'confirmed', 'patient').reason, 'patient-cannot');
});

test('[transitions] a request cannot become confirmed without being reviewed first', () => {
  assert.strictEqual(S.checkTransition('submitted', 'confirmed', 'provider').ok, false);
  assert.strictEqual(S.checkTransition('under_review', 'confirmed', 'provider').ok, true);
});

test('[transitions] declined and cancelled are final, for everyone', () => {
  ['declined', 'cancelled'].forEach((from) => {
    assert.strictEqual(S.isFinal(from), true);
    ['patient', 'provider'].forEach((actor) => {
      S.STATUSES.forEach((to) => {
        const check = S.checkTransition(from, to, actor);
        assert.strictEqual(check.ok, false);
        assert.ok(['final', 'unchanged'].includes(check.reason), from + ' -> ' + to + ': ' + check.reason);
      });
    });
  });
});

test('[transitions] bad input is refused with a reason, never thrown', () => {
  assert.strictEqual(S.checkTransition('submitted', 'shipped', 'patient').reason, 'invalid-target');
  assert.strictEqual(S.checkTransition('submitted', 'cancelled', 'admin').reason, 'invalid-actor');
  assert.strictEqual(S.checkTransition('weird', 'cancelled', 'patient').reason, 'unknown-status');
  assert.strictEqual(S.checkTransition('submitted', 'submitted', 'provider').reason, 'unchanged');
  [undefined, null, 42, {}].forEach((bad) => assert.doesNotThrow(() => S.checkTransition(bad, bad, bad)));
});

test('[transitions] every refusal has a message a person can read', () => {
  ['unknown-status', 'invalid-target', 'invalid-actor', 'unchanged', 'final', 'patient-cannot', 'not-allowed', 'not-found'].forEach((reason) => {
    assert.ok(S.describeReason(reason).length > 20, reason);
  });
  assert.ok(S.describeReason('something-new').length > 10);
});

// ---------------------------------------------------------------------------
// Never show a booking as confirmed too early
// ---------------------------------------------------------------------------

test('[confirmed] only the "confirmed" status counts as confirmed', () => {
  S.STATUSES.concat(['requested', 'weird', undefined, null, '', 'CONFIRMED', ' confirmed']).forEach((status) => {
    assert.strictEqual(S.isConfirmed({ status }), status === 'confirmed', String(status));
  });
  assert.strictEqual(S.isConfirmed(null), false);
});

test('[confirmed] a new request, an old request and an unreadable one are all shown as not confirmed', () => {
  const list = S.toDisplayList([make('a'), make('b', { status: 'requested' }), make('c', { status: 'maybe' })]);
  assert.deepStrictEqual(list.map((i) => i.confirmed), [false, false, false]);
  assert.ok(list.every((i) => !/confirmed by provider/i.test(i.statusLabel)));
});

test('[confirmed] the wording for early states says plainly that nothing is booked', () => {
  assert.match(S.getInfo('submitted').description, /not a booking and nothing is confirmed/);
  assert.match(S.getInfo('under_review').description, /not confirmed yet/);
  assert.strictEqual(S.getInfo('confirmed').label, 'Confirmed by provider');
  assert.match(S.getInfo('unknown').description, /contact the provider/);
});

test('[confirmed] the label never relies on colour alone: each status has distinct text', () => {
  const labels = S.STATUSES.map((s) => S.getInfo(s).label);
  assert.strictEqual(new Set(labels).size, S.STATUSES.length);
});

// ---------------------------------------------------------------------------
// Legacy requests
// ---------------------------------------------------------------------------

test('[legacy] "requested" (the old first status) is read as "submitted"', () => {
  assert.strictEqual(S.normalizeStatus('requested'), 'submitted');
  assert.strictEqual(S.normalizeStatus(undefined), 'submitted');
  assert.strictEqual(S.normalizeStatus(''), 'submitted');
  assert.strictEqual(S.normalizeStatus('nonsense'), 'unknown');
});

test('[legacy] an old request can be cancelled, gains a history, and keeps its other fields', () => {
  const old = { id: 'req-abc123-xyz', doctorId: 'd', doctorName: 'Dr. Old', preferredDate: '2026-10-30', preferredWindow: 'evening', status: 'requested', createdAt: '2026-10-20T05:00:00.000Z', patientEmail: 'old@example.org' };
  const result = S.cancelRequest([old], 'req-abc123-xyz', NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.request.status, 'cancelled');
  assert.strictEqual(result.request.patientEmail, 'old@example.org');
  assert.deepStrictEqual(result.request.statusHistory.map((h) => h.status), ['submitted', 'cancelled']);
});

test('[legacy] loading never changes what is stored', () => {
  const stored = [{ id: 'req-old', status: 'requested', createdAt: '2026-10-20T05:00:00.000Z', doctorName: 'Dr. Old' }];
  const copy = JSON.parse(JSON.stringify(stored));
  S.toDisplayList(stored);
  S.normalizeRequest(stored[0]);
  assert.deepStrictEqual(stored, copy);
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

test('[cancel] a patient can cancel a request that is open', () => {
  ['submitted', 'under_review', 'confirmed'].forEach((status) => {
    const result = S.cancelRequest([make('r1', { status })], 'r1', NOW);
    assert.strictEqual(result.ok, true, status);
    assert.strictEqual(result.request.status, 'cancelled');
    assert.strictEqual(result.request.cancelledAt, NOW.toISOString());
  });
});

test('[cancel] the history records who did it and when', () => {
  const result = S.cancelRequest([make('r1')], 'r1', NOW);
  assert.deepStrictEqual(result.request.statusHistory, [
    { status: 'submitted', at: NOW.toISOString(), by: 'patient' },
    { status: 'cancelled', at: NOW.toISOString(), by: 'patient' }
  ]);
});

test('[cancel] other requests are untouched and the original list is not modified', () => {
  const list = [make('r1'), make('r2'), make('r3')];
  const before = JSON.stringify(list);
  const result = S.cancelRequest(list, 'r2', NOW);
  assert.strictEqual(JSON.stringify(list), before, 'input must not be mutated');
  assert.deepStrictEqual(result.requests.map((r) => r.status), ['submitted', 'cancelled', 'submitted']);
  assert.strictEqual(result.requests[0], list[0]);
});

test('[cancel] cancelling twice is refused clearly, and does not rewrite the first time', () => {
  const first = S.cancelRequest([make('r1')], 'r1', NOW);
  const second = S.cancelRequest(first.requests, 'r1', new Date(NOW.getTime() + 60000));
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'final');
  assert.match(second.message, /already closed/);
  assert.strictEqual(second.requests[0].cancelledAt, NOW.toISOString());
});

test('[cancel] declined, unknown and missing requests cannot be cancelled', () => {
  assert.strictEqual(S.cancelRequest([make('r1', { status: 'declined' })], 'r1', NOW).reason, 'final');
  assert.strictEqual(S.cancelRequest([make('r1', { status: 'maybe' })], 'r1', NOW).reason, 'unknown-status');
  assert.strictEqual(S.cancelRequest([make('r1')], 'nope', NOW).reason, 'not-found');
  assert.strictEqual(S.cancelRequest(null, 'r1', NOW).reason, 'not-found');
  assert.strictEqual(S.cancelRequest([null, undefined, 'x'], 'r1', NOW).reason, 'not-found');
});

test('[cancel] ids are compared as text (a numeric id from storage still matches)', () => {
  assert.strictEqual(S.cancelRequest([make(42)], '42', NOW).ok, true);
});

test('[cancel] the honest note is available and says nothing is sent to the provider', () => {
  assert.match(S.CANCEL_NOTE, /this device only/);
  assert.match(S.CANCEL_NOTE, /Nothing is sent to the provider/);
});

// ---------------------------------------------------------------------------
// Provider updates (same rules as the server)
// ---------------------------------------------------------------------------

test('[provider] the full path submitted > under review > confirmed > cancelled', () => {
  let list = [make('r1')];
  ['under_review', 'confirmed', 'cancelled'].forEach((status) => {
    const result = S.applyProviderUpdate(list, 'r1', status, '2026-10-28T09:00:00.000Z');
    assert.strictEqual(result.ok, true, status);
    list = result.requests;
  });
  assert.deepStrictEqual(list[0].statusHistory.map((h) => h.status + ':' + h.by), [
    'submitted:patient', 'under_review:provider', 'confirmed:provider', 'cancelled:provider'
  ]);
});

test('[provider] skipping review, going backwards or reopening a closed request is refused', () => {
  assert.strictEqual(S.applyProviderUpdate([make('r1')], 'r1', 'confirmed').reason, 'not-allowed');
  assert.strictEqual(S.applyProviderUpdate([make('r1', { status: 'confirmed' })], 'r1', 'submitted').reason, 'not-allowed');
  assert.strictEqual(S.applyProviderUpdate([make('r1', { status: 'declined' })], 'r1', 'under_review').reason, 'final');
  assert.strictEqual(S.applyProviderUpdate([make('r1')], 'zzz', 'under_review').reason, 'not-found');
});

// ---------------------------------------------------------------------------
// Reference identifier
// ---------------------------------------------------------------------------

test('[reference] a new reference looks like RQ-XXXX-XXXX with no easily confused characters', () => {
  for (let i = 0; i < 200; i++) {
    const ref = S.newReference();
    assert.match(ref, /^RQ-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  }
});

test('[reference] references are random, not guessable from a counter or the time', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(S.newReference());
  assert.ok(seen.size >= 499, 'collisions should be extremely rare');
  assert.strictEqual(S.newReference(() => [0, 1, 2, 3, 4, 5, 6, 7]), 'RQ-ABCD-EFGH', 'deterministic for a given source');
});

test('[reference] it holds nothing about the person, the doctor or the date', () => {
  const request = Request.buildRequest(input(), { now: NOW });
  assert.match(request.id, /^RQ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const id = request.id.replace(/[^A-Z0-9]/g, '').toLowerCase();
  ['asha', 'example', 'doc1', '98000', '2026', '1030'].forEach((piece) => assert.ok(!id.includes(piece), piece));
  assert.ok(!request.id.includes(String(NOW.getTime())));
});

test('[reference] older, longer ids are shown as a short reference and stay stable', () => {
  assert.strictEqual(S.displayReference('RQ-7K3M-9P2X'), 'RQ-7K3M-9P2X');
  const legacy = S.displayReference('req-m2x9a1-k3j8dd');
  assert.match(legacy, /^RQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.strictEqual(S.displayReference('req-m2x9a1-k3j8dd'), legacy);
  assert.strictEqual(S.displayReference(''), 'RQ-0000-0000');
  assert.strictEqual(S.displayReference(undefined), 'RQ-0000-0000');
});

// ---------------------------------------------------------------------------
// What the list shows
// ---------------------------------------------------------------------------

test('[list] it shows reference, doctor, date, window and status, but never contact details or notes', () => {
  const [item] = S.toDisplayList([make('RQ-AAAA-BBBB')]);
  assert.deepStrictEqual(Object.keys(item).sort(), [
    'canCancel', 'confirmed', 'createdAt', 'doctorName', 'id', 'preferredDate', 'preferredWindow',
    'reference', 'specialty', 'status', 'statusDescription', 'statusLabel', 'tone'
  ]);
  const text = JSON.stringify(item);
  ['asha@example.org', '98000', 'Asha', 'Private note'].forEach((secret) => assert.ok(!text.includes(secret), secret));
});

test('[list] newest first, with the cancel button only where cancelling is possible', () => {
  const list = S.toDisplayList([
    make('old', { createdAt: '2026-10-01T00:00:00.000Z' }),
    make('new', { createdAt: '2026-10-20T00:00:00.000Z' }),
    make('closed', { createdAt: '2026-10-10T00:00:00.000Z', status: 'cancelled' })
  ]);
  assert.deepStrictEqual(list.map((i) => i.id), ['new', 'closed', 'old']);
  assert.deepStrictEqual(list.map((i) => i.canCancel), [true, false, true]);
});

test('[list] corrupt entries are skipped without breaking the page', () => {
  assert.deepStrictEqual(S.toDisplayList(null), []);
  assert.deepStrictEqual(S.toDisplayList('x'), []);
  assert.strictEqual(S.toDisplayList([null, 5, 'a', make('ok')]).length, 1);
  assert.doesNotThrow(() => S.toDisplayList([{}, { status: 5 }, { id: {}, doctorName: [] }]));
});

// ---------------------------------------------------------------------------
// Duplicates and double sends
// ---------------------------------------------------------------------------

function memoryStorage() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test('[duplicates] an open request blocks an identical one; submitting twice quickly saves one', () => {
  const storage = memoryStorage();
  assert.deepStrictEqual(Request.saveRequest(storage, make('a')), { ok: true });
  assert.deepStrictEqual(Request.saveRequest(storage, make('b')), { ok: false, reason: 'duplicate' });
  assert.strictEqual(Request.loadRequests(storage).length, 1);
});

test('[duplicates] every open status blocks, including a confirmed one and an old "requested"', () => {
  ['requested', 'submitted', 'under_review', 'confirmed'].forEach((status) => {
    assert.strictEqual(Request.isDuplicate([make('a', { status })], make('b')), true, status);
  });
});

test('[duplicates] after a cancel or a decline the same request can be sent again', () => {
  ['cancelled', 'declined'].forEach((status) => {
    assert.strictEqual(Request.isDuplicate([make('a', { status })], make('b')), false, status);
  });
  const storage = memoryStorage();
  Request.saveRequest(storage, make('a'));
  const cancelled = S.cancelRequest(Request.loadRequests(storage), 'a', NOW);
  storage.setItem(Request.STORAGE_KEY, JSON.stringify(cancelled.requests));
  assert.deepStrictEqual(Request.saveRequest(storage, make('b')), { ok: true });
  assert.deepStrictEqual(Request.loadRequests(storage).map((r) => r.status), ['cancelled', 'submitted']);
});

test('[duplicates] a different date, window or doctor is not a duplicate', () => {
  const existing = [make('a')];
  [{ date: '2026-10-31' }, { timeWindow: 'evening' }, { doctor: { id: 'doc-2', name: 'Dr. Two' } }].forEach((change) => {
    assert.strictEqual(Request.isDuplicate(existing, Request.buildRequest(input(change), { now: NOW, id: 'x' })), false);
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('[wiring] the page has a labelled list, a live status line and explains how to reach the provider', () => {
  const html = read('pages', 'appointments.html');
  assert.match(html, /<section[^>]*id="my-requests"[^>]*aria-labelledby="my-requests-title"/);
  assert.match(html, /id="my-requests-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /A request is not a booking/);
  assert.match(html, /doctors page/);
  assert.match(html, /quote your reference/);
});

test('[wiring] scripts load in dependency order', () => {
  const html = read('pages', 'appointments.html');
  const at = (name) => html.indexOf('assets/js/' + name);
  assert.ok(at('appointment-status.js') !== -1 && at('appointment-status.js') < at('appointment-request.js'));
  assert.ok(at('appointment-request.js') < at('appointments.js'));
  assert.ok(at('appointments.js') < at('appointment-status-ui.js'));
});

test('[wiring] the list inserts text safely and asks before cancelling', () => {
  const ui = read('assets', 'js', 'appointment-status-ui.js');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(ui));
  assert.match(ui, /data-action', 'confirm-cancel'/);
  assert.match(ui, /Yes, cancel request/);
  assert.match(ui, /Keep request/);
  assert.match(ui, /Escape/);
  assert.match(ui, /aria-label', 'Cancel request '/, 'each button names its request');
});

test('[wiring] a saved request tells the list to refresh and the success text gives the reference', () => {
  const js = read('assets', 'js', 'appointments.js');
  assert.match(js, /relief:request-saved/);
  assert.match(js, /Status\.displayReference\(request\.id\)/);
});

test('[wiring] the server-side path is documented, including idempotent creates', () => {
  const doc = read('docs', 'APPOINTMENT_STATUS.md');
  S.STATUSES.forEach((status) => assert.ok(doc.includes('`' + status + '`'), status));
  assert.match(doc, /document id/);
  assert.match(doc, /providerId/);
  const api = read('assets', 'js', 'api.js');
  assert.match(api, /\.doc\(String\(appointmentData\.id\)\)/);
  assert.match(api, /status: 'submitted'/);
});
