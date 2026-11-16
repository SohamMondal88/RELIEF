/**
 * Issue #169: text that comes from a server, a JSON file or browser storage must never be
 * inserted into the page as markup.
 *
 * The helpers are tested on their own, then every renderer that builds HTML from provider or
 * server data is fed hostile values (tags, event handlers, quotes, javascript: URLs).
 *
 * Run: node --test tests/output-escaping.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const H = require('../assets/js/safe-html.js');
const EmergencySOS = require('../assets/js/emergency-sos.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  "' onmouseover='alert(1)",
  '" onfocus="alert(1)" autofocus="',
  'javascript:alert(1)',
  '&lt;b&gt; &amp; <b>bold</b>'
];

// The page scripts are plain browser scripts: run one in a bare context (a document that does
// nothing) and take the builder functions it declares at the top level.
function loadPageScript(rel) {
  const context = vm.createContext({ ReliefSafeHtml: H, document: { addEventListener() {} } });
  vm.runInContext(read(rel), context, { filename: rel });
  return context;
}

// "<tag attr attr>" for every tag, in order, with the attribute names only. Hostile text that
// stayed text leaves this list exactly as it is for harmless text.
function tagShape(html) {
  const shape = [];
  for (const tag of html.matchAll(/<\/?([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi)) {
    shape.push(tag[1].toLowerCase() + ':' + Array.from(tag[2].replace(/="[^"]*"/g, '').matchAll(/\s([a-z-]+)/gi), (m) => m[1]).join(','));
  }
  return shape;
}

function leftoverTags(html) {
  // every "<" in the output must start a tag the template wrote, not one that came from data
  return (html.match(/<[^>]*>/g) || []).length;
}

function attrValue(html, name) {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(html);
  assert.ok(m, 'attribute ' + name + ' is missing');
  return m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function assertInert(html, benignHtml, label) {
  assert.deepStrictEqual(tagShape(html), tagShape(benignHtml), label + ': tags and attributes changed');
  assert.strictEqual(leftoverTags(html), leftoverTags(benignHtml), label + ': extra tag in output');
  assert.ok(!/<img/i.test(html) && !/<script/i.test(html) && !/<svg/i.test(html), label + ': raw tag from data');
  const tagsWithoutValues = (html.match(/<[^>]*>/g) || []).map((tag) => tag.replace(/="[^"]*"/g, '=""'));
  assert.ok(!tagsWithoutValues.some((tag) => /\son(error|load|mouseover|focus)=/i.test(tag)), label + ': event handler attribute from data');
}

// ---------------------------------------------------------------------------
// safe-html.js
// ---------------------------------------------------------------------------

test('escapeHtml escapes the five characters that matter, and copes with non-strings', () => {
  assert.strictEqual(H.escapeHtml('<a href="x" title=\'y\'>&</a>'), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.strictEqual(H.escapeHtml(null), '');
  assert.strictEqual(H.escapeHtml(undefined), '');
  assert.strictEqual(H.escapeHtml(42), '42');
  assert.strictEqual(H.escapeHtml(0), '0');
  assert.strictEqual(H.escapeHtml({ toString() { return '<b>'; } }), '&lt;b&gt;');
});

test('escapeHtml leaves ordinary text, including other scripts, alone', () => {
  for (const text of ['Dr. Sarah Johnson', "Children's Hospital, 3.1 miles away", 'ডাঃ সারাহ', 'डॉ. सारा', '+1 555 123 4567']) {
    assert.strictEqual(H.escapeHtml(text).replace(/&#39;/g, "'"), text);
  }
});

test('safeUrl keeps relative paths and http(s) and drops every other scheme', () => {
  for (const ok of ['../assets/images/doctor1.jpg', 'images/a.png', '/a/b.png', 'https://example.org/a.png', 'http://example.org/a.png', 'HTTPS://example.org/a.png']) {
    assert.strictEqual(H.safeUrl(ok), ok, ok);
  }
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '', '   ', null, undefined]) {
    assert.strictEqual(H.safeUrl(bad), '', JSON.stringify(bad));
  }
});

test('cssUrl gives a complete url("...") that cannot be broken out of, or none', () => {
  assert.strictEqual(H.cssUrl('../assets/images/doctor1.jpg'), 'url("../assets/images/doctor1.jpg")');
  assert.strictEqual(H.cssUrl('javascript:alert(1)'), 'none');
  assert.strictEqual(H.cssUrl(''), 'none');
  assert.strictEqual(H.cssUrl('my%20photo.jpg'), 'url("my%20photo.jpg")', 'an existing %20 is not encoded twice');

  const out = H.cssUrl("x\");background:url('javascript:alert(1)');--y:(\\");
  assert.ok(out.startsWith('url("') && out.endsWith('")'));
  const inner = out.slice(5, -2);
  assert.ok(!/["'()\\;\s]/.test(inner), 'quotes, brackets, backslash, semicolon and spaces are encoded: ' + inner);
});

// ---------------------------------------------------------------------------
// doctors, pharmacies, ambulances, first aid
// ---------------------------------------------------------------------------

test('doctor card: hostile fields stay text and the image can not leave its url()', () => {
  const { buildDoctorCardHtml } = loadPageScript('assets/js/doctors.js');
  const benign = buildDoctorCardHtml({ id: 1, name: 'A', specialty: 'B', location: 'C', rating: 4.5, reviews: 10, availability: 'D', image: '../a.jpg', bio: 'E' });

  for (const payload of PAYLOADS) {
    const html = buildDoctorCardHtml({ id: payload, name: payload, specialty: payload, location: payload, rating: 4.5, reviews: payload, availability: payload, image: '../a.jpg', bio: payload });
    assertInert(html, benign, 'doctor ' + payload);
    assert.strictEqual(attrValue(html, 'data-id'), payload, 'data-id keeps the exact text');
  }

  for (const image of ["x');background:url(javascript:alert(1)", 'javascript:alert(1)', '" onerror="alert(1)', '"><img src=x onerror=alert(1)>', 'data:text/html,<script>alert(1)</script>']) {
    const html = buildDoctorCardHtml({ id: 1, name: 'A', specialty: 'B', location: 'C', rating: 4, reviews: 1, availability: 'D', image, bio: 'E' });
    assertInert(html, benign, 'doctor image ' + image);
    const style = attrValue(html, 'style');
    assert.ok(/^background-image: (none|url\("[^"'();\s\\]*"\))$/.test(style), 'style is one url() or none: ' + style);
  }
});

test('doctor card: an out of range rating does not throw', () => {
  const { buildDoctorCardHtml } = loadPageScript('assets/js/doctors.js');
  for (const rating of [-3, 9, NaN, '<b>', null, undefined, Infinity]) {
    assert.doesNotThrow(() => buildDoctorCardHtml({ id: 1, name: 'A', specialty: 'B', location: 'C', rating, reviews: 1, availability: 'D', image: '', bio: 'E' }), String(rating));
  }
});

test('doctor card: normal data still renders as before', () => {
  const { buildDoctorCardHtml } = loadPageScript('assets/js/doctors.js');
  const html = buildDoctorCardHtml({ id: 3, name: "Dr. Emily O'Rodriguez", specialty: 'Pediatrician', location: "Children's Hospital, 3.1 miles away", rating: 4.9, reviews: 156, availability: 'Available this week', image: '../assets/images/doctor3.jpg', bio: 'Pediatric specialist & more.' });
  assert.match(html, /style="background-image: url\(&quot;\.\.\/assets\/images\/doctor3\.jpg&quot;\)"/);
  assert.ok(html.includes('Dr. Emily O&#39;Rodriguez'));
  assert.ok(html.includes('Pediatric specialist &amp; more.'));
  assert.ok(html.includes('(156 reviews)'));
  assert.strictEqual((html.match(/fas fa-star"/g) || []).length, 4);
  assert.ok(html.includes('fa-star-half-alt'));
  assert.ok(html.includes('data-id="3"'));
});

test('pharmacy card and popup: hostile fields stay text, phone attribute round trips', () => {
  const { buildPharmacyCardHtml, buildPharmacyPopupHtml } = loadPageScript('assets/js/pharmacies.js');
  const base = { id: 1, name: 'A', type: 'B', location: 'C', services: ['D'], phone: '+1 555 123 4567', hours: { monFri: 'E', sat: 'F', sun: 'G' }, image: '../a.jpg' };
  const benign = buildPharmacyCardHtml(base);
  const benignPopup = buildPharmacyPopupHtml(base);

  for (const payload of PAYLOADS) {
    const hostile = { id: payload, name: payload, type: payload, location: payload, services: [payload, 'ok'], phone: payload, hours: { monFri: payload, sat: payload, sun: payload }, image: '../a.jpg' };
    const html = buildPharmacyCardHtml(hostile);
    const shapeBenign = buildPharmacyCardHtml(Object.assign({}, base, { services: ['D', 'ok'] }));
    assertInert(html, shapeBenign, 'pharmacy ' + payload);
    assert.strictEqual(attrValue(html, 'data-phone'), payload, 'data-phone keeps the exact text');
    assert.strictEqual(attrValue(html, 'data-id'), payload);

    assertInert(buildPharmacyPopupHtml(hostile), benignPopup, 'pharmacy popup ' + payload);
  }

  for (const image of ["x');background:url(javascript:alert(1)", 'javascript:alert(1)', '"><img src=x onerror=alert(1)>']) {
    const html = buildPharmacyCardHtml(Object.assign({}, base, { image }));
    assertInert(html, benign, 'pharmacy image ' + image);
    assert.ok(/^background-image: (none|url\("[^"'();\s\\]*"\))$/.test(attrValue(html, 'style')));
  }
});

test('pharmacy card: missing hours or services do not throw', () => {
  const { buildPharmacyCardHtml } = loadPageScript('assets/js/pharmacies.js');
  assert.doesNotThrow(() => buildPharmacyCardHtml({ id: 1, name: 'A', type: 'B', location: 'C', phone: '1', image: '' }));
});

test('ambulance item and popup: hostile fields stay text, attributes round trip', () => {
  const { buildAmbulanceItemHtml, buildAmbulancePopupHtml } = loadPageScript('assets/js/ambulances.js');
  const base = { id: 1, name: 'A', location: 'C', phone: '+1 555 911 0000', responseTime: '5-10 minutes', lat: 40.7, lng: -74 };
  const benign = buildAmbulanceItemHtml(base);
  const benignPopup = buildAmbulancePopupHtml(base);

  for (const payload of PAYLOADS) {
    const hostile = { id: 1, name: payload, location: payload, phone: payload, responseTime: payload, lat: payload, lng: payload };
    const html = buildAmbulanceItemHtml(hostile);
    assertInert(html, benign, 'ambulance ' + payload);
    assert.strictEqual(attrValue(html, 'data-phone'), payload);
    assert.strictEqual(attrValue(html, 'data-lat'), payload);
    assert.strictEqual(attrValue(html, 'data-lng'), payload);

    assertInert(buildAmbulancePopupHtml(hostile), benignPopup, 'ambulance popup ' + payload);
  }
});

test('first aid: the title is escaped, the guide body is the one trusted rich HTML', () => {
  const { buildGuideItemHtml } = loadPageScript('assets/js/firstaid.js');
  const benign = buildGuideItemHtml({ title: 'CPR', content: '<p>Steps</p>' });

  for (const payload of PAYLOADS) {
    const html = buildGuideItemHtml({ title: payload, content: '<p>Steps</p>' });
    assertInert(html, benign, 'first aid title ' + payload);
  }

  const rich = buildGuideItemHtml({ title: 'CPR', content: '<p>Call <strong>112</strong></p><ol class="guide-steps"><li>One</li></ol>' });
  assert.ok(rich.includes('<ol class="guide-steps"><li>One</li></ol>'), 'guide content keeps its formatting');
});

test('first aid: every guide that ships is written in the file, and the docs say content is trusted', () => {
  const source = read('assets/js/firstaid.js');
  assert.match(source, /guide\.content is the one place that\s+\/\/ keeps trusted rich HTML/);
  assert.match(read('docs/FIRST_AID_REVIEW_CHECKLIST.md'), /trusted rich HTML/i);
});

// ---------------------------------------------------------------------------
// SOS dialog
// ---------------------------------------------------------------------------

function renderSosDialog(lastResult, state) {
  const saved = global.document;
  global.document = { getElementById: () => null, addEventListener() {}, createElement: () => ({}) };
  try {
    const controller = new EmergencySOS.EmergencySOSController({ defaultRegion: 'IN' });
    controller.state = state || EmergencySOS.SOS_STATES.FAILED;
    controller.lastResult = lastResult;
    const container = { innerHTML: '' };
    controller.renderDialog(container);
    return container.innerHTML;
  } finally {
    global.document = saved;
  }
}

test('SOS dialog: a hostile server message and guidance are shown as text', () => {
  const baseline = renderSosDialog({ success: false, delivered: false, state: EmergencySOS.SOS_STATES.FAILED, message: 'm', guidance: 'g' });
  for (const payload of PAYLOADS) {
    const html = renderSosDialog({ success: false, delivered: false, state: EmergencySOS.SOS_STATES.FAILED, message: payload, guidance: payload });
    assertInert(html, baseline, 'sos ' + payload);
    assert.ok(html.includes('<p class="relief-sos-status-msg">' + H.escapeHtml(payload) + '</p>'), 'message is the escaped text');
    assert.ok(html.includes('<p>' + H.escapeHtml(payload) + '</p>'), 'guidance is the escaped text');
  }
});

test('SOS dialog: the numbers and the Retry button are still there with a hostile message', () => {
  const html = renderSosDialog({ success: false, delivered: false, state: EmergencySOS.SOS_STATES.FAILED, message: '<img src=x onerror=alert(1)>', guidance: '<b>x</b>' });
  assert.ok(html.includes('href="tel:112"'));
  assert.ok(html.includes('relief-sos-retry-btn'));
  assert.ok(html.includes('relief-sos-sms-btn'));
});

test('SOS dialog: a message that came back from dispatchSOS (HTTP 200, not confirmed) is escaped end to end', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const result = await EmergencySOS.dispatchSOS({ urgency: 'HIGH' }, {
    endpoint: 'https://example.com/api/sos',
    isOnline: () => true,
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ delivered: false, message: hostile }) })
  });
  assert.strictEqual(result.message, hostile, 'dispatchSOS passes the server text through, escaping happens where it is shown');
  const html = renderSosDialog(result, result.state);
  assert.ok(!html.includes('<img'), 'no tag from the server');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('SOS dialog: harmless server text is shown unchanged apart from escaping', () => {
  const html = renderSosDialog({ success: false, delivered: true, state: EmergencySOS.SOS_STATES.SENT, message: "Request #12 accepted: don't hang up", guidance: 'Keep your phone line open.' });
  assert.ok(html.includes('Request #12 accepted: don&#39;t hang up'));
  assert.ok(html.includes('Keep your phone line open.'));
});

// ---------------------------------------------------------------------------
// pages and service worker
// ---------------------------------------------------------------------------

test('each page that renders these cards loads safe-html.js before its own script', () => {
  const pages = { 'pages/doctors.html': ['doctors.js'], 'pages/pharmacies.html': ['pharmacies.js'], 'pages/ambulances.html': ['ambulances.js', 'emergency-sos.js'], 'pages/firstaid.html': ['firstaid.js'] };
  for (const [page, scripts] of Object.entries(pages)) {
    const html = read(page);
    const helper = html.indexOf('assets/js/safe-html.js');
    assert.ok(helper > -1, page + ' does not load safe-html.js');
    for (const script of scripts) {
      assert.ok(helper < html.indexOf('assets/js/' + script), page + ': safe-html.js must come before ' + script);
    }
  }
});

test('sw.js saves safe-html.js for the offline first aid page', () => {
  const sw = read('sw.js');
  assert.match(sw, /'assets\/js\/safe-html\.js'/);
});

test('the SOS dialog no longer interpolates the server message or guidance directly', () => {
  assert.ok(!/\$\{res\.(message|guidance)\}/.test(read('assets/js/emergency-sos.js')));
});
