/**
 * Structural checks for firebase/firestore.rules (no emulator needed).
 * Behaviour is verified separately against the emulator, see docs/FIREBASE_SECURITY.md.
 *
 * node --test tests/firebase-rules.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rules = fs.readFileSync(path.join(ROOT, 'firebase', 'firestore.rules'), 'utf8');
const apiSource = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'api.js'), 'utf8');

function collectionsUsedByApi() {
  const names = new Set();
  for (const m of apiSource.matchAll(/db\.collection\(\s*['"]([^'"]+)['"]\s*\)/g)) names.add(m[1]);
  return [...names];
}

test('every collection api.js writes to has a rule', () => {
  const used = collectionsUsedByApi();
  assert.ok(used.length >= 5, 'expected to find the collections used by api.js');
  used.forEach((name) => {
    assert.match(rules, new RegExp('match /' + name + '/\\{'), name + ' has no match block');
  });
});

test('everything not listed is denied by a catch-all rule', () => {
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});

test('no rule is open to everyone', () => {
  assert.ok(!/allow [^;]*:\s*if true/.test(rules));
  assert.ok(!/allow [^;:]*;/.test(rules), 'every allow needs an explicit condition');
});

test('request documents cannot be edited by the client', () => {
  ['emergencyRequests', 'medicineDeliveries'].forEach((name) => {
    const block = rules.split('match /' + name + '/')[1].split('match /')[0];
    assert.match(block, /allow update: if false;/, name + ' should not allow client updates');
  });
});

test('created requests must use the server clock and a fixed starting status', () => {
  assert.match(rules, /createdAt == request\.time/);
  assert.match(rules, /timestamp == request\.time/);
  assert.match(rules, /status == 'pending'/);
  assert.match(rules, /status == 'requested'/);
  assert.match(rules, /status == 'submitted'/, 'appointment requests start as submitted');
});

test('appointment status changes follow the same table as the page (appointment-status.js)', () => {
  const Status = require('../assets/js/appointment-status.js');
  const block = rules.split('match /appointments/')[1].split('match /')[0];
  assert.match(block, /allow update:/, 'updates are decided by explicit conditions');
  assert.ok(!/allow update: if false/.test(block));

  // The provider table in the rules lists exactly the moves the page allows.
  const moves = [];
  Object.keys(Status.TRANSITIONS).forEach((from) => {
    Status.TRANSITIONS[from].provider.forEach((to) => moves.push(from + '>' + to));
  });
  const fn = rules.split('function providerMayMove')[1].split('}')[0];
  const found = [];
  fn.split('||').forEach((clause) => {
    const from = (clause.match(/from == '(\w+)'/) || [])[1];
    const targets = clause.match(/to (?:in \[([^\]]*)\]|== '(\w+)')/);
    if (!from || !targets) return;
    (targets[1] ? targets[1].match(/'(\w+)'/g).map((t) => t.replace(/'/g, '')) : [targets[2]]).forEach((to) => found.push(from + '>' + to));
  });
  assert.deepStrictEqual(found.sort(), moves.sort(), 'rules and appointment-status.js disagree about provider moves');

  // And the patient may cancel exactly from the open statuses.
  const cancelFrom = (rules.split('function patientMayCancel')[1].split('}')[0].match(/\[([^\]]*)\]/)[1].match(/'(\w+)'/g) || []).map((t) => t.replace(/'/g, ''));
  const pageCancelFrom = Object.keys(Status.TRANSITIONS).filter((from) => Status.TRANSITIONS[from].patient.includes('cancelled'));
  assert.deepStrictEqual(cancelFrom.sort(), pageCancelFrom.sort());
});

test('providers are limited to requests for their own provider id', () => {
  assert.match(rules, /token\.providerId == resource\.data\.doctorId/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['status', 'cancelledAt'\]\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['status', 'statusUpdatedAt'\]\)/);
});

test('profiles block self-granted privileges', () => {
  assert.match(rules, /hasAny\(\[[^\]]*'isAdmin'[^\]]*\]\)/);
  assert.match(rules, /'role'/);
});

test('firebase.json points at the rules file that exists', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase', 'firebase.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(ROOT, 'firebase', cfg.firestore.rules)));
});

test('App Check stays off unless a site key is provided', () => {
  assert.match(apiSource, /RELIEF_APP_CHECK_SITE_KEY/);
  assert.match(apiSource, /appCheckSiteKey && typeof firebase\.appCheck === 'function'/);
});
