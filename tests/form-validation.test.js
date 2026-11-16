/**
 * Accessible validation for the appointment and reminder forms (Issue #65), extended to the contact,
 * sign-in and location forms (Issue #112).
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

// ---------------------------------------------------------------------------
// Issue #112: one field at a time, errors that go away on edit, contact and sign-in forms
// ---------------------------------------------------------------------------

test('[field] showFieldError marks one field and shows its message without moving focus or touching others', () => {
  const doc = reminderDom();
  FE.showFieldError(doc, FIELDS.time, 'Pick a time.');
  assert.strictEqual(doc.byId['time-error'].textContent, 'Pick a time.');
  assert.strictEqual(doc.byId['time-error'].hidden, false);
  assert.strictEqual(doc.byId.time.getAttribute('aria-invalid'), 'true');
  assert.ok(doc.byId.time.getAttribute('aria-describedby').split(' ').includes('time-error'));
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-invalid'), null);
  assert.strictEqual(doc.getFocused(), null);
  assert.strictEqual(doc.byId.summary.hidden, true, 'a blur check does not open the summary');
});

test('[field] clearFieldError clears one field and drops its row from the summary, the others stay', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { medicine: 'Enter a medicine name.', time: 'Pick a time.', endDate: 'Check the end date.' }, OPTS);
  FE.clearFieldError(doc, 'time', OPTS);

  assert.strictEqual(doc.byId.time.getAttribute('aria-invalid'), null);
  assert.strictEqual(doc.byId['time-error'].hidden, true);
  assert.strictEqual(doc.byId['time-error'].textContent, '');
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-invalid'), 'true');
  const text = textOf(doc.byId.summary);
  assert.match(text, /2 problems/);
  assert.ok(text.includes('Enter a medicine name.') && text.includes('Check the end date.'));
  assert.ok(!text.includes('Pick a time.'));
});

test('[field] clearing the last problem hides the summary, and a hint in aria-describedby survives', () => {
  const doc = reminderDom();
  doc.byId.time.setAttribute('aria-describedby', 'time-hint');
  FE.applyErrors(doc, { time: 'Pick a time.' }, OPTS);
  FE.clearFieldError(doc, 'time', OPTS);
  assert.strictEqual(doc.byId.summary.hidden, true);
  assert.strictEqual(doc.byId.summary.children.length, 0);
  assert.strictEqual(doc.byId.time.getAttribute('aria-describedby'), 'time-hint');
});

test('[field] an error with no field stays in the summary when a field is fixed', () => {
  const doc = reminderDom();
  FE.applyErrors(doc, { time: 'Pick a time.', form: 'Could not save.' }, OPTS);
  FE.clearFieldError(doc, 'time', OPTS);
  assert.strictEqual(doc.byId.summary.hidden, false);
  assert.match(textOf(doc.byId.summary), /1 problem\b/);
  assert.match(textOf(doc.byId.summary), /Could not save/);
});

test('[field] bindFieldClearing clears a field when it is edited, only if it shows an error, and keeps the typed value', () => {
  const doc = reminderDom();
  FE.bindFieldClearing(doc, OPTS);
  FE.applyErrors(doc, { medicine: 'Enter a medicine name.', time: 'Pick a time.' }, OPTS);

  doc.byId.medicine.value = 'Metformin 500';
  doc.byId.medicine.fire('input', {});
  assert.strictEqual(doc.byId.medicine.getAttribute('aria-invalid'), null);
  assert.strictEqual(doc.byId['medicine-error'].hidden, true);
  assert.strictEqual(doc.byId.medicine.value, 'Metformin 500', 'the typed value stays');
  assert.strictEqual(doc.byId.time.getAttribute('aria-invalid'), 'true', 'the other field still shows its error');

  // A field without an error is left alone.
  doc.byId['end-date'].fire('change', {});
  assert.strictEqual(doc.byId['end-date'].getAttribute('aria-invalid'), null);

  doc.byId.time.fire('change', {});
  assert.strictEqual(doc.byId.summary.hidden, true, 'no problems left, no summary');
});

test('[field] values the person typed survive an invalid submit and the correction that follows', () => {
  const doc = reminderDom();
  doc.byId.medicine.value = '';
  doc.byId.time.value = '25:99';
  doc.byId['end-date'].value = '2026-01-01';
  FE.applyErrors(doc, { medicine: 'a', time: 'b' }, OPTS);
  assert.strictEqual(doc.byId.time.value, '25:99');
  assert.strictEqual(doc.byId['end-date'].value, '2026-01-01', 'a valid field keeps its value');
  doc.byId.time.value = '07:30';
  FE.clearErrors(doc, OPTS);
  assert.strictEqual(doc.byId.time.value, '07:30');
  assert.strictEqual(doc.byId['end-date'].value, '2026-01-01');
});

// ---- contact rules ----

const ContactSend = require('../assets/js/contact-send.js');
const Auth = require('../assets/js/auth-mode.js');
const goodContact = (extra) => Object.assign({ name: 'Asha Rao', email: 'asha@example.com', message: 'I can help on weekends.', consent: true }, extra);

test('[contact] a complete form has no errors, and the subject is optional', () => {
  assert.deepStrictEqual(ContactSend.validate(goodContact()), {});
  assert.deepStrictEqual(ContactSend.validate(goodContact({ subject: '' })), {});
});

test('[contact] every required field reports its own message, listed in page order', () => {
  const errors = ContactSend.validate({ name: '', email: '', message: '', consent: false });
  assert.deepStrictEqual(Object.keys(errors), ContactSend.FIELD_ORDER);
  assert.strictEqual(errors.name, 'Please enter your name');
  assert.strictEqual(errors.consent, 'You must agree to the privacy policy');
});

test('[contact] short, malformed and whitespace-only values are refused with a way to fix them', () => {
  assert.match(ContactSend.validate(goodContact({ name: 'A' })).name, /at least 2/);
  assert.match(ContactSend.validate(goodContact({ name: '   ' })).name, /Please enter your name/);
  assert.match(ContactSend.validate(goodContact({ email: 'asha@example' })).email, /valid email/);
  assert.match(ContactSend.validate(goodContact({ email: 'asha example@x.org' })).email, /valid email/);
  assert.match(ContactSend.validate(goodContact({ message: 'too short' })).message, /at least 10/);
  assert.deepStrictEqual(Object.keys(ContactSend.validate(goodContact({ name: 'A', message: 'x' }))), ['name', 'message']);
});

test('[contact] validate does not change the values it is given', () => {
  const values = goodContact({ name: '  Asha  ', email: ' asha@example.com ' });
  const copy = Object.assign({}, values);
  ContactSend.validate(values);
  assert.deepStrictEqual(values, copy);
  assert.deepStrictEqual(ContactSend.validate(values), {}, 'surrounding spaces are not an error');
});

const BAD_DOMAINS = ['asha@example..com', 'asha@.example.com', 'asha@example.com.', 'asha@-example.com', 'asha@example-.com', 'asha@example.-com', 'asha@example.com-', 'asha@..'];
const GOOD_DOMAINS = ['asha@example.com', 'a.b+c@sub.example.co.in', 'asha@my-site.example.org', 'asha@xn--mnchen-3ya.de'];

test('[contact] an email with an empty or hyphen-edged domain label is refused, normal ones pass', () => {
  BAD_DOMAINS.forEach((email) => {
    assert.match(ContactSend.validate(goodContact({ email })).email || '', /valid email/, 'should reject "' + email + '"');
  });
  GOOD_DOMAINS.forEach((email) => {
    assert.strictEqual(ContactSend.validate(goodContact({ email })).email, undefined, 'should accept "' + email + '"');
  });
});

test('[auth] sign-in and sign-up refuse the same malformed domains', () => {
  BAD_DOMAINS.forEach((email) => {
    assert.match(Auth.validateLogin({ email, password: 'x' }).email || '', /valid email/, 'login should reject "' + email + '"');
    assert.match(Auth.validateSignup({ name: 'Asha', email, password: 'secret1', confirmPassword: 'secret1', terms: true }).email || '', /valid email/, 'signup should reject "' + email + '"');
  });
  GOOD_DOMAINS.forEach((email) => {
    assert.strictEqual(Auth.validateLogin({ email, password: 'x' }).email, undefined, 'login should accept "' + email + '"');
  });
});

// ---- sign-in rules ----

test('[auth] login needs a valid email and a password, and says which one is missing', () => {
  assert.deepStrictEqual(Auth.validateLogin({ email: 'a@b.co', password: 'x' }), {});
  assert.deepStrictEqual(Object.keys(Auth.validateLogin({ email: '', password: '' })), ['email', 'password']);
  assert.match(Auth.validateLogin({ email: 'nope', password: 'x' }).email, /valid email/);
  assert.deepStrictEqual(Object.keys(Auth.validateLogin({ email: 'a@b.co', password: '' })), ['password']);
  assert.deepStrictEqual(Object.keys(Auth.validateLogin()), ['email', 'password'], 'no argument is the same as empty');
});

test('[auth] a password made of spaces is a password: it is never trimmed', () => {
  assert.deepStrictEqual(Auth.validateLogin({ email: 'a@b.co', password: '      ' }), {});
  assert.deepStrictEqual(Auth.validateSignup({ name: 'A', email: 'a@b.co', password: '      ', confirmPassword: '      ', terms: true }), {});
});

test('[auth] signup reports every problem at once, in page order', () => {
  const none = Auth.validateSignup({});
  assert.deepStrictEqual(Object.keys(none), ['name', 'email', 'password', 'confirmPassword', 'terms']);
  const ok = Auth.validateSignup({ name: 'Asha', email: 'asha@example.com', password: 'abcdef', confirmPassword: 'abcdef', terms: true });
  assert.deepStrictEqual(ok, {});
});

test('[auth] signup keeps the existing messages for a short password and a mismatch', () => {
  const short = Auth.validateSignup({ name: 'A', email: 'a@b.co', password: 'abc', confirmPassword: 'abc', terms: true });
  assert.deepStrictEqual(short, { password: 'Password must be at least 6 characters.' });
  const mismatch = Auth.validateSignup({ name: 'A', email: 'a@b.co', password: 'abcdef', confirmPassword: 'abcdeg', terms: true });
  assert.deepStrictEqual(mismatch, { confirmPassword: 'Passwords do not match.' });
  const terms = Auth.validateSignup({ name: 'A', email: 'a@b.co', password: 'abcdef', confirmPassword: 'abcdef', terms: false });
  assert.deepStrictEqual(Object.keys(terms), ['terms']);
});

// ---- page markup for the contact, login and signup forms ----

const FORM_PAGES = [
  { page: 'contact.html', form: 'contactForm', summary: 'contact-error-summary', script: 'contact.js', keys: ['name', 'email', 'message', 'consent'] },
  { page: 'login.html', form: 'login-form', summary: 'login-error-summary', script: 'login.js', keys: ['login-email', 'login-password'] },
  { page: 'signup.html', form: 'signup-form', summary: 'signup-error-summary', script: 'signup.js', keys: ['signup-name', 'signup-email', 'signup-password', 'signup-confirm-password', 'terms'] }
];

test('[markup] contact, login and signup use novalidate so the shared messages replace the browser bubbles', () => {
  FORM_PAGES.forEach(({ page, form }) => {
    const tag = (read('pages', page).match(new RegExp('<form[^>]*id="' + form + '"[^>]*>')) || [])[0];
    assert.ok(tag, page);
    assert.ok(/\snovalidate[\s>]/.test(tag), page + ' needs novalidate');
  });
});

test('[markup] contact, login and signup have a focusable alert summary that starts hidden', () => {
  FORM_PAGES.forEach(({ page, summary }) => {
    const tag = (read('pages', page).match(new RegExp('<div[^>]*id="' + summary + '"[^>]*>')) || [])[0];
    assert.ok(tag, page + ' needs #' + summary);
    assert.strictEqual(attr(tag, 'role'), 'alert');
    assert.strictEqual(attr(tag, 'tabindex'), '-1');
    assert.ok(/\shidden[\s>]/.test(tag), 'starts hidden');
  });
});

test('[markup] every checked field on those pages has a hidden message element next to its own id', () => {
  FORM_PAGES.forEach(({ page, keys }) => {
    const html = read('pages', page);
    keys.forEach((id) => {
      assert.match(html, new RegExp('id="' + id + '"'), page + ' ' + id);
      assert.match(html, new RegExp('<span class="error-message" id="' + id + '-error" hidden></span>'), page + ' ' + id + '-error');
    });
  });
});

test('[markup] contact fields point at their messages from the start', () => {
  const { inputs } = inputsIn(read('pages', 'contact.html'), 'contactForm');
  ['name', 'email', 'message', 'consent'].forEach((id) => {
    const tag = inputs.find((t) => attr(t, 'id') === id);
    assert.strictEqual(attr(tag, 'aria-describedby'), id + '-error', id);
  });
});

test('[markup] contact name and email say what they are for (autocomplete)', () => {
  const { inputs } = inputsIn(read('pages', 'contact.html'), 'contactForm');
  assert.strictEqual(attr(inputs.find((t) => attr(t, 'id') === 'name'), 'autocomplete'), 'name');
  assert.strictEqual(attr(inputs.find((t) => attr(t, 'id') === 'email'), 'autocomplete'), 'email');
});

test('[markup] the helper loads before the script that uses it, and the styles unhide messages', () => {
  FORM_PAGES.forEach(({ page, script }) => {
    const html = read('pages', page);
    const helper = html.indexOf('assets/js/form-errors.js');
    assert.ok(helper !== -1 && helper < html.indexOf('assets/js/' + script), page);
  });
  ['contact.css', 'auth.css'].forEach((file) => {
    const css = read('assets', 'css', file);
    assert.match(css, /\.error-message\[hidden\]/, file);
    assert.match(css, /\.error-summary:focus/, file);
    assert.match(css, /\[aria-invalid="true"\]/, file);
  });
});

test('[wiring] contact, login and signup send invalid submits through the shared helper', () => {
  ['contact', 'login', 'signup'].forEach((name) => {
    const js = read('assets', 'js', name + '.js');
    assert.match(js, /ReliefFormErrors\.applyErrors/, name);
    assert.match(js, /ReliefFormErrors\.bindFieldClearing/, name);
    assert.match(js, /ReliefFormErrors\.bindSummaryLinks/, name);
  });
});

test('[wiring] the location box is marked invalid when its text is refused and cleared when edited', () => {
  const js = read('assets', 'js', 'location-panel.js');
  assert.match(js, /setAttribute\('aria-invalid', 'true'\)/);
  assert.match(js, /removeAttribute\('aria-invalid'\)/);
  assert.match(js, /aria-describedby="location-error"/);
  assert.match(js, /id="location-error" class="location-error" role="alert"/);
});
