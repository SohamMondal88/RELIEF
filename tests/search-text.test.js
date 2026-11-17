/**
 * Tests for the shared search text helper (Issue #175).
 * Run with: node --test tests/search-text.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../assets/js/search-text.js');
const U = require('../assets/js/facility-utils.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('case and white space: equivalent queries normalize to the same text', () => {
  const same = ['cardiologist delhi', 'Cardiologist Delhi', 'CARDIOLOGIST   DELHI', '  cardiologist\tdelhi\n', 'cardiologist delhi', 'cardiologist delhi'];
  same.forEach((q) => assert.strictEqual(S.normalize(q), 'cardiologist delhi', JSON.stringify(q)));
});

test('invisible characters from copied text are removed', () => {
  assert.strictEqual(S.normalize('car​dio‌‍⁠﻿'), 'cardio');
  assert.strictEqual(S.normalize('‎‏clinic­'), 'clinic');
});

test('empty, blank and non-text values give an empty string, 0 stays 0', () => {
  [undefined, null, '', ' ', '   \t\n', ' ​ '].forEach((v) => assert.strictEqual(S.normalize(v), '', JSON.stringify(v)));
  assert.strictEqual(S.normalize(0), '0');
  assert.deepStrictEqual(S.tokens('   '), []);
  assert.deepStrictEqual(S.tokens('  two   words '), ['two', 'words']);
});

test('a blank query matches every record', () => {
  ['', '   ', ' ', '​', null, undefined].forEach((q) => assert.strictEqual(S.matches(['Anything'], q), true, JSON.stringify(q)));
});

test('accents: composed and decomposed forms find each other, accents are kept', () => {
  assert.strictEqual(S.matches(['Café Rama'], 'café'), true);
  assert.strictEqual(S.matches(['Café Rama'], 'CAFÉ'), true);
  assert.strictEqual(S.matches(['Café Rama'], 'cafe'), false, 'accents are not stripped');
  assert.strictEqual(S.matches(['Strasse'], 'Straße'), true);
});

test('Bengali: composed and decomposed letters find each other', () => {
  // য় = U+09DF or য + nukta, ড় = U+09DC or ড + nukta, ো = U+09CB or ে + া
  const pairs = [['য়', 'য়'], ['ড়', 'ড়'], ['ো', 'ো']];
  pairs.forEach(([a, b]) => {
    assert.strictEqual(S.normalize('ক' + a), S.normalize('ক' + b));
    assert.strictEqual(S.matches(['হাসপাতাল ক' + a], 'ক' + b), true);
    assert.strictEqual(S.matches(['হাসপাতাল ক' + b], 'ক' + a), true);
  });
});

test('Bengali: whole words, mixed English and Bengali, and a Bengali word is not turned into another', () => {
  const hospital = 'হাসপাতাল'; // হাসপাতাল
  const kolkata = 'কলকাতা'; // কলকাতা
  const record = ['Sample ' + hospital, kolkata, 'Maternity'];
  assert.strictEqual(S.matches(record, kolkata), true);
  assert.strictEqual(S.matches(record, '  ' + hospital + '​  MATERNITY '), true);
  assert.strictEqual(S.matches(record, 'sample ' + kolkata), true);
  assert.strictEqual(S.matches(record, 'হাস'), true, 'a prefix still matches');
  assert.strictEqual(S.matches(record, 'হিসপাতাল'), false, 'a different vowel sign is a different word');
  assert.strictEqual(S.normalize('নি'), 'নি', 'vowel signs survive');
});

test('punctuation is kept, but curly quotes and dashes match the plain ones', () => {
  assert.strictEqual(S.matches(["St. Mary's Clinic"], "st. mary's"), true);
  assert.strictEqual(S.matches(["St Mary's Clinic"], 'st.'), false, 'the dot is part of the word, it is not dropped');
  assert.strictEqual(S.matches(["Children's Ward"], 'children’s'), true);
  assert.strictEqual(S.matches(['24-Hour Drug Mart'], '24‑hour'), true);
  assert.strictEqual(S.matches(['24-Hour Drug Mart'], '24–hour'), true);
  assert.strictEqual(S.matches(['Open 24/7'], '24/7'), true);
  assert.strictEqual(S.matches(['Open 24/7'], '247'), false);
  assert.strictEqual(S.normalize('(ICU) & C++'), '(icu) & c++');
});

test('full width and compatibility characters fold to their plain form', () => {
  assert.strictEqual(S.normalize('ＣＬＩＮＩＣ'), 'clinic');
  assert.strictEqual(S.normalize('①'), '1');
});

test('every word must be found, in any order, and words may sit in different fields', () => {
  const record = ['Dr. Sarah Johnson', 'Cardiologist', 'Heart care in Delhi'];
  assert.strictEqual(S.matches(record, 'delhi cardiologist'), true);
  assert.strictEqual(S.matches(record, 'sarah heart'), true);
  assert.strictEqual(S.matches(record, 'sarah paediatric'), false);
});

test('a missing field is skipped, not searched as the text "undefined"', () => {
  assert.strictEqual(S.matches(['Name', undefined, null], 'undefined'), false);
  assert.strictEqual(S.matches(['Name', undefined, null], 'null'), false);
  assert.strictEqual(S.matches([], 'x'), false);
  assert.strictEqual(S.matches([], ''), true);
});

test('indexText normalizes once and matchesIndex gives the same answer as matches', () => {
  const fields = ['Dr. Sarah  Johnson', 'Cardiologist​'];
  const index = S.indexText(fields);
  assert.strictEqual(index, 'dr. sarah johnson cardiologist');
  ['SARAH', 'sarah   cardio', 'nothing', ''].forEach((q) => assert.strictEqual(S.matchesIndex(index, q), S.matches(fields, q)));
});

test('the text shown to the person is never changed', () => {
  const name = '  Café​   RAMA ';
  const copy = name;
  S.normalize(name);
  S.matches([name], 'rama');
  assert.strictEqual(name, copy);
});

test('htmlToText leaves the readable words and drops tags, class names and attributes', () => {
  const html = '<p>Stop the <b>bleeding</b></p><div class="guide-warning"><i class="fas fa-exclamation-triangle"></i><span>Call &amp; wait</span></div>';
  const text = S.htmlToText(html);
  assert.match(text, /Stop the\s+bleeding/);
  assert.match(text, /Call & wait/);
  assert.doesNotMatch(text, /div|class|guide-warning|exclamation|<|>/);
  assert.strictEqual(S.htmlToText('a&nbsp;b &#39;c&#x27; &unknown;'), "a b 'c' &unknown;");
  assert.strictEqual(S.htmlToText(null), '');
});

test('first aid: a search for markup finds nothing, a search for words finds the guide', () => {
  const guide = '<p>Cool the burn.</p><ul><li>Run cool water</li></ul><div class="guide-warning"><span>Do not use ice</span></div>';
  const index = S.indexText(['Treating Burns', S.htmlToText(guide)]);
  ['div', 'class', 'guide-warning', '<li>', 'ul'].forEach((q) => assert.strictEqual(S.matchesIndex(index, q), false, q));
  ['burn', 'COOL   water', 'do not use ice', 'treating'].forEach((q) => assert.strictEqual(S.matchesIndex(index, q), true, q));
});

// ---------- the hospital list uses the same rules ----------

const facilities = U.normalizeFacilities([
  { id: 'h1', name: 'Café Road Clinic', district: 'Kolkata', type: 'clinic', services: ['Maternity'] },
  { id: 'h2', name: 'হাসপাতাল কয়', district: 'কলকাতা', type: 'hospital', services: [] },
  { id: 'h3', name: "Children's Ward", district: 'Howrah', type: 'hospital', services: ['24-hour care'] }
]);
const ids = (search) => U.filterFacilities(facilities, { search }).map((f) => f.id);

test('hospital search: case, extra spaces, no-break and invisible characters give the same list', () => {
  const base = ids('maternity kolkata');
  assert.deepStrictEqual(base, ['h1']);
  ['MATERNITY   KOLKATA', '  maternity kolkata ', 'maternity​ kolkata', 'Kolkata\tMaternity'].forEach((q) => assert.deepStrictEqual(ids(q), base, JSON.stringify(q)));
});

test('hospital search: decomposed and composed text, Bengali, quotes and dashes', () => {
  assert.deepStrictEqual(ids('café'), ['h1']);
  assert.deepStrictEqual(ids('হাসপাতাল কয়'), ['h2'], 'য় typed as য plus nukta finds the single character');
  assert.deepStrictEqual(ids('কলকাতা'), ['h2']);
  assert.deepStrictEqual(ids('children’s'), ['h3']);
  assert.deepStrictEqual(ids('24‑hour'), ['h3']);
});

test('hospital search: an empty or blank query lists everything', () => {
  ['', '   ', ' ', '​​', undefined].forEach((q) => assert.strictEqual(ids(q).length, 3, JSON.stringify(q)));
});

// ---------- every page that uses it loads it first ----------

test('every page that has a search box loads search-text.js before the script that uses it', () => {
  const pairs = {
    'pages/hospitals.html': 'facility-utils.js',
    'pages/admin-panel.html': 'facility-utils.js',
    'pages/doctors.html': 'doctors.js',
    'pages/pharmacies.html': 'pharmacies.js',
    'pages/firstaid.html': 'firstaid.js',
    'pages/blog.html': 'blog.js'
  };
  for (const [page, script] of Object.entries(pairs)) {
    const html = read(page);
    const helper = html.indexOf('assets/js/search-text.js');
    const user = html.indexOf('assets/js/' + script);
    assert.ok(helper !== -1, page + ' loads search-text.js');
    assert.ok(user !== -1 && helper < user, page + ': search-text.js must come before ' + script);
  }
});

test('no search box compares raw lower cased text any more', () => {
  const doctors = read('assets/js/doctors.js');
  const pharmacies = read('assets/js/pharmacies.js');
  const firstaid = read('assets/js/firstaid.js');
  assert.doesNotMatch(doctors, /includes\(searchTerm\)/);
  assert.doesNotMatch(pharmacies, /includes\(searchTerm\)/);
  assert.doesNotMatch(firstaid, /includes\(searchTerm\)/);
  assert.doesNotMatch(firstaid, /guide\.content\.toLowerCase/);
});
