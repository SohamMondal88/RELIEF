// Guards the process in docs/FIRST_AID_REVIEW_CHECKLIST.md (Issue #90). These checks do not judge medical
// content. They only make sure the register matches the articles, the site never says "medically approved"
// for something no clinician reviewed, and emergency numbers survive translation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const STATUSES = ['Not reviewed', 'Source-checked', 'Clinician reviewed'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function articleTitles() {
  const source = read('assets/js/firstaid.js');
  const titles = [];
  source.replace(/^\s*title:\s*"([^"]+)"/gm, (_, title) => titles.push(title));
  return titles;
}

function registerRows() {
  const doc = read('docs/FIRST_AID_REVIEW_CHECKLIST.md');
  const start = doc.indexOf('## 6. Article register');
  assert.ok(start !== -1, 'the doc needs its "## 6. Article register" section');
  const rows = [];
  for (const line of doc.slice(start).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === 'Article' || /^-+$/.test(cells[0])) continue;
    rows.push({ article: cells[0], sources: cells[1], status: cells[2], checkedOn: cells[3], reviewer: cells[4], nextDue: cells[5] });
  }
  return rows;
}

test('the article list in firstaid.js is found', () => {
  assert.ok(articleTitles().length >= 5, 'expected the first aid articles to be readable from firstaid.js');
});

test('every first aid article has a register row and every row has an article', () => {
  const titles = articleTitles();
  const rows = registerRows().map((row) => row.article);
  for (const title of titles) assert.ok(rows.includes(title), `"${title}" is in firstaid.js but not in the register`);
  for (const row of rows) assert.ok(titles.includes(row), `"${row}" is in the register but not in firstaid.js`);
  assert.strictEqual(new Set(rows).size, rows.length, 'an article is listed twice in the register');
});

test('register statuses are valid and a claimed review has a source, a date and (for clinicians) a reviewer', () => {
  for (const row of registerRows()) {
    assert.ok(STATUSES.includes(row.status), `"${row.article}" has status "${row.status}", expected one of ${STATUSES.join(', ')}`);
    if (row.status === 'Not reviewed') {
      assert.strictEqual(row.reviewer, '', `"${row.article}" is Not reviewed but names a reviewer`);
      continue;
    }
    assert.match(row.sources, /\]\(https:\/\/[^)\s]+\)/, `"${row.article}" needs at least one linked https source`);
    assert.match(row.checkedOn, ISO_DATE, `"${row.article}" needs a Checked on date as YYYY-MM-DD`);
    assert.match(row.nextDue, ISO_DATE, `"${row.article}" needs a Next review due date as YYYY-MM-DD`);
    assert.ok(row.nextDue > row.checkedOn, `"${row.article}" next review is not after the check`);
    const months6 = new Date(row.checkedOn);
    months6.setMonth(months6.getMonth() + 6);
    assert.ok(new Date(row.nextDue) <= months6, `"${row.article}" next review is more than 6 months after the check`);
    if (row.status === 'Clinician reviewed') {
      assert.match(row.reviewer, /\S+,\s*\S+/, `"${row.article}" needs the reviewer as "Name, role"`);
    } else {
      assert.strictEqual(row.reviewer, '', `"${row.article}" is Source-checked, not clinician reviewed, so no reviewer is named`);
    }
  }
});

test('no page, script or translation says content is medically approved while no article is clinician reviewed', () => {
  const anyClinicianReviewed = registerRows().some((row) => row.status === 'Clinician reviewed');
  const files = ['index.html']
    .concat(fs.readdirSync(path.join(root, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f))
    .concat(fs.readdirSync(path.join(root, 'assets', 'js')).filter((f) => f.endsWith('.js')).map((f) => 'assets/js/' + f))
    .concat(fs.readdirSync(path.join(root, 'assets', 'locales')).map((f) => 'assets/locales/' + f));
  const claim = /\b(medically|clinically)[ -](approved|verified|validated|certified|reviewed)\b|\b(doctor|physician|clinician|expert)[ -](approved|verified|reviewed)\b|\b(approved|verified|reviewed|checked|endorsed) by (a |our |the )?(doctors?|physicians?|clinicians?|medical (experts?|professionals?|board))\b/i;
  const negation = /\b(not|no|never|without|neither|nor|pending|until|before)\b[^.]{0,60}$/i;
  const found = [];
  for (const file of files) {
    read(file).split('\n').forEach((line, index) => {
      const match = claim.exec(line);
      if (!match) return;
      // "must not be described as clinically approved" is a warning, not a claim.
      if (negation.test(line.slice(0, match.index))) return;
      found.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  if (anyClinicianReviewed) return; // once a clinician has signed off, wording is a review matter, see the doc
  assert.deepStrictEqual(found, [], 'wording that claims medical approval, but no article is Clinician reviewed');
});

test('emergency numbers in English strings are still in the Bengali string (Latin or Bengali digits)', () => {
  const en = JSON.parse(read('assets/locales/en.json'));
  const bn = JSON.parse(read('assets/locales/bn.json'));
  const toLatin = (text) => text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09E6));
  let checked = 0;
  for (const [key, value] of Object.entries(en)) {
    const numbers = value.match(/\b(?:100|101|102|108|112|911|999)\b/g);
    if (!numbers) continue;
    checked += 1;
    const translated = toLatin(bn[key] || '');
    for (const number of new Set(numbers)) {
      assert.ok(translated.includes(number), `${key}: "${number}" is in en.json but not in bn.json`);
    }
  }
  assert.ok(checked >= 3, 'expected to find the emergency number strings');
});

test('the checklist is linked from the docs a contributor reads first', () => {
  for (const file of ['README.md', 'docs/CONTRIBUTING_SETUP.md', 'docs/MEDICALLY_CAUTIOUS_GUIDANCE.md']) {
    assert.match(read(file), /FIRST_AID_REVIEW_CHECKLIST\.md/, `${file} should link to the first aid review checklist`);
  }
  const doc = read('docs/FIRST_AID_REVIEW_CHECKLIST.md');
  for (const heading of ['Authoritative sources', 'Red flags', 'Emergency escalation', 'Plain language', 'Translation accuracy', 'Review dates']) {
    assert.ok(doc.includes(heading), `the checklist should cover "${heading}"`);
  }
});
