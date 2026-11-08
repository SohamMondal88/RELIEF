/**
 * Accessible validation for the appointment and reminder forms (Issue #65).
 *
 * Covers the validation rules, the way errors are announced (inline message, aria-invalid,
 * aria-describedby, error summary, focus), that typed values are kept, and the page markup.
 *
 * node --test tests/form-validation.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const FE = require('../assets/js/form-errors.js');
const Request = require('../assets/js/appointment-request.js');
const Reminders = require('../assets/js/reminders.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ---------------------------------------------------------------------------
// A small fake DOM: enough to observe attributes, text, hidden state and focus
// ---------------------------------------------------------------------------

function fakeDom(markup) {
  const byId = {};
  let focused = null;

  function element(id, attrs) {
    const el = {
      id, tag: 'div', attrs: Object.assign({}, attrs), children: [], hidden: false, textContent: '', value: '',
      className: '', listeners: {},
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      get firstChild() { return this.children[0] || null; },
      focus() { focused = this; },
      addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
      fire(name, event) { (this.listeners[name] || []).forEach((fn) => fn(event)); }
    };
    if (id) byId[id] = el;
    return el;
  }

  (markup || []).forEach((m) => { element(m.id, m.attrs).tag = m.tag || 'input'; });

  return {
    byId,
    getFocused: () => focused,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => { const e = element(null); e.tag = tag; return e; }
  };
}

const ids = (list) => list.map((id) => ({ id }));

function textOf(node) {
  return node.textContent + node.children.map(textOf).join('');
}

// ---------------------------------------------------------------------------
// Appointment rules
// ---------------------------------------------------------------------------

const NOW = new Date(2026, 9, 27, 10, 0, 0); // Tue 27 Oct 2026, 10:00 local
const goodRequest = (extra) => Object.assign({
  doctor: { id: 'd1', name: 'Dr. Example' },
  date: '2026-10-30',
  timeWindow: 'morning',
  name: 'Asha Example',
  email: 'asha@example.org',
  phone: '+91 98000 00000',
  notes: '',
  consent: true
}, extra);

const check = (extra) => Request.validateRequest(goodRequest(extra), { now: NOW });

test('[appointment] a complete request is valid', () => {
  const r = check();
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
  assert.strictEqual(r.firstInvalid, null);
});

test('[appointment] required fields: each empty value names its own problem', () => {
  const r = Request.validateRequest({}, { now: NOW });
  assert.strictEqual(r.valid, false);
  ['doctor', 'date', 'timeWindow', 'name', 'email', 'phone', 'consent'].forEach((key) => {
    assert.ok(r.errors[key], key + ' should have an error');
  });
  const messages = Object.values(r.errors);
  assert.strictEqual(new Set(messages).size, messages.length, 'each error should be specific');
  messages.forEach((m) => assert.ok(m.length > 10, 'message is too short to help: ' + m));
});

test('[appointment] dates: missing, impossible, past, today and too far ahead', () => {
  assert.ok(check({ date: '' }).errors.date);
  assert.ok(check({ date: '2026-02-30' }).errors.date);
  assert.ok(check({ date: 'tomorrow' }).errors.date);
  assert.ok(check({ date: '2026-10-26' }).errors.date, 'yesterday');
  assert.strictEqual(check({ date: '2026-10-27' }).errors.date, undefined, 'today is allowed');
  assert.ok(check({ date: '2030-01-01' }).errors.date, 'far in the future');
});

test('[appointment] a time window that already ended today is refused', () => {
  const late = new Date(2026, 9, 27, 19, 0, 0);
  const r = Request.validateRequest(goodRequest({ date: '2026-10-27', timeWindow: 'morning' }), { now: late });
  assert.ok(r.errors.timeWindow);
  assert.strictEqual(r.errors.date, undefined);
});

test('[appointment] contact formats: email', () => {
  ['asha@example.org', 'a.b+c@sub.example.co.in'].forEach((email) => assert.strictEqual(check({ email }).errors.email, undefined, email));
  ['', 'asha', 'asha@', '@example.org', 'asha@example', 'a b@example.org', 'asha@@example.org'].forEach((email) => {
    assert.ok(check({ email }).errors.email, 'should reject "' + email + '"');
  });
});

test('[appointment] contact formats: phone', () => {
  ['+91 98000 00000', '098000 00000', '9800000000', '+91-98000-00000'].forEach((phone) => {
    assert.strictEqual(check({ phone }).errors.phone, undefined, phone);
  });
  ['', 'call me', '12345', '+91 abc', '1'.repeat(20), '5550101010', '033 2241 4239'].forEach((phone) => {
    assert.ok(check({ phone }).errors.phone, 'should reject "' + phone + '"');
  });
});

test('[appointment] name length and notes length', () => {
  assert.ok(check({ name: '' }).errors.name);
  assert.ok(check({ name: 'A' }).errors.name);
  assert.ok(check({ name: 'x'.repeat(101) }).errors.name);
  assert.strictEqual(check({ name: 'Al' }).errors.name, undefined);
  assert.ok(check({ notes: 'x'.repeat(501) }).errors.notes);
  assert.strictEqual(check({ notes: 'x'.repeat(500) }).errors.notes, undefined);
});

test('[appointment] consent must be an explicit yes', () => {
  [false, undefined, 'true', 1, null].forEach((consent) => {
    assert.ok(check({ consent }).errors.consent, 'consent ' + String(consent));
  });
});

test('[appointment] firstInvalid follows the order on the page', () => {
  const r = Request.validateRequest({ consent: false }, { now: NOW });
  assert.strictEqual(r.firstInvalid, Request.FIELD_ORDER.find((k) => r.errors[k]));
  assert.strictEqual(Request.validateRequest(goodRequest({ phone: 'x', consent: false }), { now: NOW }).firstInvalid, 'phone');
});

test('[appointment] malformed input never throws', () => {
  [null, undefined, 'x', 5, [], { name: {}, email: [], phone: () => 1, date: new Date() }].forEach((input) => {
    assert.doesNotThrow(() => Request.validateRequest(input, { now: NOW }));
  });
});

// ---------------------------------------------------------------------------
// Reminder rules
// ---------------------------------------------------------------------------

const rctx = { today: '2026-10-27' };
const rcheck = (input) => Reminders.validateReminderInput(Object.assign({ medicine: 'Vitamin D', time: '08:00' }, input), rctx);

test('[reminder] a minimal reminder is valid and optional dates may be blank', () => {
  const r = rcheck({});
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
  assert.strictEqual(r.value.startDate, '');
});

test('[reminder] required fields', () => {
  const r = Reminders.validateReminderInput({}, rctx);
  assert.ok(r.errors.medicine);
  assert.ok(r.errors.time);
  assert.ok(rcheck({ medicine: '   ' }).errors.medicine, 'spaces only is empty');
});

test('[reminder] time must be HH:MM on a real clock', () => {
  ['00:00', '08:30', '23:59'].forEach((time) => assert.strictEqual(rcheck({ time }).errors.time, undefined, time));
  ['8am', '24:00', '12:60', '99:99', 'abc', '12'].forEach((time) => assert.ok(rcheck({ time }).errors.time, 'should reject ' + time));
});

test('[reminder] dates: invalid, reversed, and an end date that has passed', () => {
  assert.ok(rcheck({ startDate: '2026-13-01' }).errors.startDate);
  assert.ok(rcheck({ endDate: '2026-02-30' }).errors.endDate);
  assert.ok(rcheck({ startDate: '2026-11-10', endDate: '2026-11-01' }).errors.endDate);
  assert.ok(rcheck({ endDate: '2026-10-01' }).errors.endDate);
  assert.strictEqual(rcheck({ startDate: '2026-11-01', endDate: '2026-11-01' }).errors.endDate, undefined, 'same day is fine');
  assert.strictEqual(rcheck({ endDate: '2026-10-27' }).errors.endDate, undefined, 'ends today is fine');
});

test('[reminder] length limits', () => {
  assert.ok(rcheck({ medicine: 'x'.repeat(81) }).errors.medicine);
  assert.ok(rcheck({ instructions: 'x'.repeat(301) }).errors.instructions);
  assert.strictEqual(rcheck({ medicine: 'x'.repeat(80), instructions: 'x'.repeat(300) }).valid, true);
});

test('[reminder] several problems are all reported together, not one at a time', () => {
  const r = Reminders.validateReminderInput({ medicine: '', time: '', startDate: 'bad', endDate: 'bad' }, rctx);
  assert.deepStrictEqual(Object.keys(r.errors).sort(), ['endDate', 'medicine', 'startDate', 'time']);
});

test('[reminder] messages say how to fix the problem', () => {
  const r = Reminders.validateReminderInput({ medicine: '', time: '99:99', startDate: '2026-11-10', endDate: '2026-11-01' }, rctx);
  assert.match(r.errors.medicine, /Enter/);
  assert.match(r.errors.time, /valid time|HH:MM/);
  assert.match(r.errors.endDate, /before the start/);
});

test('[reminder] valid input is normalised, not rejected', () => {
  const r = rcheck({ medicine: '  Vitamin    D  ' });
  assert.strictEqual(r.value.medicine, 'Vitamin D');
});

// ---------------------------------------------------------------------------
// Announcing errors: inline message, aria-invalid, aria-describedby, summary, focus
// ---------------------------------------------------------------------------

const FIELDS = {
  medicine: { focusId: 'medicine', errorId: 'medicine-error' },
  time: { focusId: 'time', errorId: 'time-error' },
  endDate: { focusId: 'end-date', errorId: 'end-date-error' }
};
const ORDER = ['medicine', 'time', 'endDate'];

function reminderDom() {
  const doc = fakeDom([
    { id: 'medicine' }, { id: 'time' }, { id: 'end-date' },
    { id: 'medicine-error', tag: 'p' }, { id: 'time-error', tag: 'p' }, { id: 'end-date-error', tag: 'p' },
    { id: 'summary', tag: 'div' }
  ]);
  ['medicine-error', 'time-error', 'end-date-error', 'summary'].forEach((id) => { doc.byId[id].hidden = true; });
  doc.byId.medicine.value = 'Metformin';
  doc.byId.medicine.setAttribute('aria-describedby', 'medicine-error');
  doc.byId.time.setAttribute('aria-describedby', 'time-error');
  doc.byId['end-date'].value = '2026-01-01';
  return doc;
}
const OPTS = { fields: FIELDS, order: ORDER, summaryId: 'summary' };

test('[announce] each field gets its message, aria-invalid and a link to the message', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: 'Enter a medicine name.', time: 'Pick a time.' }, OPTS);

  assert.strictEqual(doc.byId['medicine-error'].textContent, 'Enter a medicine name.');
  assert.strictEqual(doc.byId['medicine-error'].hidden, false);
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-invalid'), 'true');
  assert.ok(doc.byId.medicine.getAttribute('aria-describedby').split(' ').includes('medicine-error'));
  assert.strictEqual(doc.byId.time.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(doc.byId['end-date'].getAttribute('aria-invalid'), null, 'a valid field is not marked invalid');
  assert.strictEqual(doc.byId['end-date-error'].hidden, true);
});

test('[announce] a field with no message element yet still gets one linked on', () => {
  const doc = reminderDom();
  doc.byId['end-date'].removeAttribute('aria-describedby');
  FE.applyErrors(doc, { endDate: 'End date cannot be before the start date.' }, OPTS);
  assert.strictEqual(doc.byId['end-date'].getAttribute('aria-describedby'), 'end-date-error');
});

test('[announce] existing descriptions (hints) are kept and the link is not duplicated', () => {
  const doc = reminderDom();
  doc.byId.time.setAttribute('aria-describedby', 'time-hint');
  FE.applyErrors(doc, { time: 'Pick a time.' }, OPTS);
  FE.applyErrors(doc, { time: 'Pick a time.' }, OPTS);
  assert.deepStrictEqual(doc.byId.time.getAttribute('aria-describedby').split(' '), ['time-hint', 'time-error']);
  FE.clearErrors(doc, OPTS);
  assert.strictEqual(doc.byId.time.getAttribute('aria-describedby'), 'time-hint', 'the hint survives clearing');
});

test('[announce] markup that already points at the error element is not damaged by clearing', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: 'Enter a medicine name.' }, OPTS);
  FE.clearErrors(doc, OPTS);
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-describedby'), 'medicine-error');
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-invalid'), null);
});

test('[announce] the summary lists every problem as a link to its field', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { time: 'Pick a time.', medicine: 'Enter a medicine name.' }, OPTS);
  const summary = doc.byId.summary;
  assert.strictEqual(summary.hidden, false);
  const text = textOf(summary);
  assert.match(text, /2 problems/);
  assert.ok(text.indexOf('Enter a medicine name.') < text.indexOf('Pick a time.'), 'listed in page order, not object order');

  const list = summary.children[1];
  const links = list.children.map((li) => li.children[0]);
  assert.deepStrictEqual(links.map((a) => a.href), ['#medicine', '#time']);
});

test('[announce] several problems move focus to the summary', () => {
  const doc = reminderDom();
  const out = FE.applyErrors(doc, { medicine: 'a', time: 'b' }, OPTS);
  assert.strictEqual(out.focused, 'summary');
  assert.strictEqual(doc.getFocused(), doc.byId.summary);
});

test('[announce] a single problem moves focus straight to that field', () => {
  const doc = reminderDom();
  const out = FE.applyErrors(doc, { time: 'Pick a time.' }, OPTS);
  assert.strictEqual(out.focused, 'field');
  assert.strictEqual(doc.getFocused(), doc.byId.time);
  assert.match(textOf(doc.byId.summary), /1 problem\b/);
});

test('[announce] an error with no field (for example "could not save") reaches the summary and gets focus there', () => {
  const doc = reminderDom();
  const out = FE.applyErrors(doc, { form: 'Could not save reminders in this browser.' }, OPTS);
  assert.strictEqual(out.focused, 'summary');
  assert.match(textOf(doc.byId.summary), /Could not save/);
  assert.strictEqual(doc.byId.summary.children[1].children[0].children.length, 0, 'plain text, not a dead link');
});

test('[announce] focus can be left to the caller', () => {
  const doc = reminderDom();
  const out = FE.applyErrors(doc, { time: 'Pick a time.' }, Object.assign({ focus: false }, OPTS));
  assert.strictEqual(out.focused, null);
  assert.strictEqual(doc.getFocused(), null);
});

test('[announce] fixing the problems clears every sign of them', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: 'a', time: 'b', endDate: 'c' }, OPTS);
  FE.clearErrors(doc, OPTS);
  Object.keys(FIELDS).forEach((key) => {
    const field = doc.byId[FIELDS[key].focusId];
    const message = doc.byId[FIELDS[key].errorId];
    assert.strictEqual(field.getAttribute('aria-invalid'), null, key);
    assert.strictEqual(message.hidden, true, key);
    assert.strictEqual(message.textContent, '', key);
  });
  assert.strictEqual(doc.byId.summary.hidden, true);
  assert.strictEqual(doc.byId.summary.children.length, 0);
});

test('[announce] a second run replaces the first: stale messages never linger', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: 'a', time: 'b' }, OPTS);
  FE.applyErrors(doc, { time: 'b' }, OPTS);
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-invalid'), null);
  assert.strictEqual(doc.byId['medicine-error'].hidden, true);
  assert.match(textOf(doc.byId.summary), /1 problem\b/);
});

test('[announce] what the user typed is never changed', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: 'a', time: 'b', endDate: 'c' }, OPTS);
  FE.clearErrors(doc, OPTS);
  assert.strictEqual(doc.byId.medicine.value, 'Metformin');
  assert.strictEqual(doc.byId['end-date'].value, '2026-01-01');
});

test('[announce] a radio group can carry aria-invalid on its fieldset', () => {
  const doc = fakeDom([{ id: 'window-morning' }, { id: 'time-window-group', tag: 'fieldset' }, { id: 'time-window-error', tag: 'p' }]);
  const fields = { timeWindow: { focusId: 'window-morning', errorId: 'time-window-error', groupId: 'time-window-group' } };
  FE.applyErrors(doc, { timeWindow: 'Choose a time window.' }, { fields, order: ['timeWindow'] });
  assert.strictEqual(doc.byId['time-window-group'].getAttribute('aria-invalid'), 'true');
  assert.strictEqual(doc.byId['window-morning'].getAttribute('aria-invalid'), null);
  assert.strictEqual(doc.getFocused(), doc.byId['window-morning']);
});

test('[announce] messages are inserted as text, never as HTML', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: '<img src=x onerror=alert(1)>' }, OPTS);
  assert.strictEqual(doc.byId['medicine-error'].textContent, '<img src=x onerror=alert(1)>');
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'form-errors.js'), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(source));
});

test('[announce] unknown, empty and non-string errors are ignored without throwing', () => {
  const doc = reminderDom();
  assert.doesNotThrow(() => FE.applyErrors(doc, { medicine: '', time: null, endDate: 5, nothing: undefined }, OPTS));
  assert.deepStrictEqual(FE.buildSummary(null, ORDER, FIELDS), []);
  assert.deepStrictEqual(FE.buildSummary('x', ORDER, FIELDS), []);
  assert.strictEqual(doc.byId.summary.hidden, true);
});

test('[announce] a summary link focuses its field, after letting a multi-step form show the right step', () => {
  const doc = reminderDom();
  const seen = [];
  FE.bindSummaryLinks(doc, 'summary', (id) => seen.push(id));
  let prevented = false;
  doc.byId.summary.fire('click', {
    target: { closest: () => ({ getAttribute: () => 'end-date' }) },
    preventDefault() { prevented = true; }
  });
  assert.strictEqual(prevented, true);
  assert.deepStrictEqual(seen, ['end-date']);
  assert.strictEqual(doc.getFocused(), doc.byId['end-date']);

  // Clicking something that is not a link does nothing.
  doc.byId.summary.fire('click', { target: { closest: () => null }, preventDefault() { throw new Error('should not run'); } });
});

// ---------------------------------------------------------------------------
// Page markup
// ---------------------------------------------------------------------------

function inputsIn(html, formId) {
  const start = html.indexOf('id="' + formId + '"');
  const end = html.indexOf('</form>', start);
  const block = html.slice(start, end);
  return { block, inputs: block.match(/<(?:input|textarea|select)\b[^>]*>/g) || [] };
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
  return m ? m[1] : null;
}

test('[markup] reminder form: every field has a label, a hidden message element and points at it', () => {
  const html = read('pages', 'dashboard.html');
  const { block, inputs } = inputsIn(html, 'reminder-form');
  // Radio buttons are labelled by their own text and grouped by a fieldset legend, so they are checked separately.
  const visible = inputs.filter((tag) => attr(tag, 'type') !== 'hidden' && attr(tag, 'type') !== 'radio');
  assert.strictEqual(visible.length, 6, 'five fields and the time zone list');
  visible.forEach((tag) => {
    const id = attr(tag, 'id');
    assert.match(block, new RegExp('<label for="' + id + '"'), id + ' needs a label');
    const describedBy = (attr(tag, 'aria-describedby') || '').split(' ');
    const errorId = describedBy.find((t) => t.endsWith('-error'));
    assert.ok(errorId, id + ' must point at its error message');
    assert.match(html, new RegExp('<p class="field-error" id="' + errorId + '" hidden></p>'), errorId + ' must exist and start hidden');
  });
});

test('[markup] required reminder fields are announced as required', () => {
  const { inputs } = inputsIn(read('pages', 'dashboard.html'), 'reminder-form');
  ['medicine', 'time'].forEach((id) => {
    const tag = inputs.find((t) => attr(t, 'id') === id);
    assert.ok(/\srequired[\s>]/.test(tag), id + ' is required');
    assert.strictEqual(attr(tag, 'aria-required'), 'true');
  });
});

test('[markup] reminder and appointment pages have an alert summary that can take focus', () => {
  [['dashboard.html', 'reminder-error-summary'], ['appointments.html', 'appointment-error-summary']].forEach(([page, id]) => {
    const html = read('pages', page);
    const tag = (html.match(new RegExp('<div[^>]*id="' + id + '"[^>]*>')) || [])[0];
    assert.ok(tag, page + ' needs #' + id);
    assert.strictEqual(attr(tag, 'role'), 'alert');
    assert.strictEqual(attr(tag, 'tabindex'), '-1');
    assert.ok(/\shidden[\s>]/.test(tag), 'starts hidden');
  });
});

test('[markup] appointment form: every field points at an existing, hidden error element', () => {
  const html = read('pages', 'appointments.html');
  const { inputs } = inputsIn(html, 'patient-form');
  assert.ok(inputs.length >= 5);
  inputs.forEach((tag) => {
    const id = attr(tag, 'id');
    const errorId = (attr(tag, 'aria-describedby') || '').split(' ').find((t) => t.endsWith('-error'));
    assert.ok(errorId, id + ' must point at its error message');
    assert.match(html, new RegExp('id="' + errorId + '" hidden'), errorId + ' must exist and start hidden');
  });
});

test('[markup] appointment date, time window and doctor errors exist too', () => {
  const html = read('pages', 'appointments.html');
  ['preferred-date-error', 'time-window-error', 'doctor-error'].forEach((id) => assert.match(html, new RegExp('id="' + id + '"')));
  assert.match(html, /<fieldset class="window-group" id="time-window-group" aria-describedby="time-window-error">/);
});

test('[markup] pages load the helper before the scripts that use it', () => {
  [['dashboard.html', 'dashboard.js'], ['appointments.html', 'appointments.js']].forEach(([page, script]) => {
    const html = read('pages', page);
    const helper = html.indexOf('assets/js/form-errors.js');
    assert.ok(helper !== -1 && helper < html.indexOf('assets/js/' + script), page + ' must load form-errors.js first');
  });
});

test('[markup] error colours are not the only signal: every message is text and the field has aria-invalid', () => {
  const css = read('assets', 'css', 'dashboard.css');
  assert.match(css, /input\[aria-invalid="true"\]/);
  assert.match(css, /\.error-summary:focus/, 'the focused summary must have a visible outline');
});

test('[wiring] invalid submissions go through the shared helper, never a silent return', () => {
  const dash = read('assets', 'js', 'dashboard.js');
  assert.match(dash, /FE\.applyErrors/);
  assert.ok(!/errorBox/.test(dash), 'the old unlabelled error list is gone');
  const appt = read('assets', 'js', 'appointments.js');
  assert.match(appt, /FormErrors\.applyErrors/);
  assert.match(appt, /focusErrors\(/);
});
