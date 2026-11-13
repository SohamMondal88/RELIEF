/**
 * Tests for scripts/audit-check.js (Issue #58).
 * The fixture is real `npm audit --json` output for a project that depends on minimist 1.2.0
 * (one moderate and one critical advisory).
 * Run with: node --test tests/audit-check.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const A = require('../scripts/audit-check.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'npm-audit-minimist.json');
const report = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const NOW = new Date('2026-11-10T10:00:00Z');
const CRITICAL = 'GHSA-xvch-5gv4-984h';
const MODERATE = 'GHSA-vh95-rmgr-6w4m';

test('advisoryId pulls the GHSA id out of the advisory link', () => {
  assert.strictEqual(A.advisoryId('https://github.com/advisories/' + CRITICAL), CRITICAL);
  assert.strictEqual(A.advisoryId('https://example.com/nothing'), null);
  assert.strictEqual(A.advisoryId(undefined), null);
});

test('collectAdvisories lists each advisory once with its own severity', () => {
  const list = A.collectAdvisories(report());
  assert.deepStrictEqual(list.map((a) => a.id).sort(), [CRITICAL, MODERATE].sort());
  assert.strictEqual(list.find((a) => a.id === CRITICAL).severity, 'critical');
  assert.strictEqual(list.find((a) => a.id === MODERATE).severity, 'moderate');
  assert.strictEqual(list.find((a) => a.id === CRITICAL).fix, 'minimist@1.2.8');
});

test('a package that only passes a problem up is not counted as an advisory', () => {
  const r = { vulnerabilities: { parent: { severity: 'high', via: ['child'], isDirect: true } } };
  assert.deepStrictEqual(A.collectAdvisories(r), []);
});

test('the default level is high: the critical advisory fails, the moderate one does not', () => {
  const result = A.evaluate(report(), [], { now: NOW });
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.findings.map((a) => a.id), [CRITICAL]);
});

test('--level moderate also reports the moderate advisory, --level critical only the critical one', () => {
  assert.strictEqual(A.evaluate(report(), [], { now: NOW, level: 'moderate' }).findings.length, 2);
  assert.strictEqual(A.evaluate(report(), [], { now: NOW, level: 'critical' }).findings.length, 1);
});

test('an allow-listed advisory is skipped and only that one', () => {
  const allow = [{ id: CRITICAL, reason: 'not reachable: only used by a dev script', expires: '2026-12-31' }];
  const result = A.evaluate(report(), allow, { now: NOW, level: 'moderate' });
  assert.deepStrictEqual(result.findings.map((a) => a.id), [MODERATE]);
  assert.deepStrictEqual(result.problems, []);
});

test('an expired allowlist entry stops working and is reported', () => {
  const allow = [{ id: CRITICAL, reason: 'was fine', expires: '2026-11-09' }];
  const result = A.evaluate(report(), allow, { now: NOW });
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.findings.map((a) => a.id), [CRITICAL]);
  assert.match(result.problems.join(' '), /expired on 2026-11-09/);
});

test('an allowlist entry without a reason or an expiry does not count', () => {
  const result = A.evaluate(report(), [{ id: CRITICAL }], { now: NOW });
  assert.strictEqual(result.findings.length, 1);
  assert.match(result.problems.join(' '), /needs an id/);
});

test('an empty report is ok', () => {
  assert.strictEqual(A.evaluate({ vulnerabilities: {} }, [], { now: NOW }).ok, true);
});

function run(args, input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-check-'));
  const file = path.join(dir, 'audit.json');
  fs.writeFileSync(file, input);
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'audit-check.js'), file].concat(args), { encoding: 'utf8' });
}

test('the command exits 1 and names the advisory, its fix and the doc', () => {
  const r = run([], fs.readFileSync(FIXTURE, 'utf8'));
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, new RegExp(CRITICAL));
  assert.match(r.stdout, /fix: minimist@1\.2\.8/);
  assert.match(r.stdout, /docs\/SECURITY_SCANNING\.md/);
});

test('the command exits 0 for a clean report', () => {
  const r = run([], JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }));
  assert.strictEqual(r.status, 0);
});

test('the command exits 2, not 0, when npm audit could not run', () => {
  const r = run([], JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request to registry failed' } }));
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /did not produce a report/);
});

test('every entry in the allowlist that ships with the repo is complete', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'audit-allowlist.json'), 'utf8'));
  const result = A.evaluate({ vulnerabilities: {} }, data.allow, { now: new Date(0) });
  assert.deepStrictEqual(result.problems, []);
});
