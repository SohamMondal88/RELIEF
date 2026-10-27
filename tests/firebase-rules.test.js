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
  ['appointments', 'emergencyRequests', 'medicineDeliveries'].forEach((name) => {
    const block = rules.split('match /' + name + '/')[1].split('match /')[0];
    assert.match(block, /allow update: if false;/, name + ' should not allow client updates');
  });
});

test('created requests must use the server clock and a fixed starting status', () => {
  assert.match(rules, /createdAt == request\.time/);
  assert.match(rules, /timestamp == request\.time/);
  assert.match(rules, /status == 'pending'/);
  assert.match(rules, /status == 'requested'/);
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
