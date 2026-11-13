#!/usr/bin/env node
/**
 * Reads the JSON that `npm audit --json` prints and fails when it lists an advisory at or above
 * a severity (default high) that is not in scripts/audit-allowlist.json.
 *
 *   npm audit --json > audit.json; node scripts/audit-check.js audit.json
 *   node scripts/audit-check.js audit.json --level critical
 *   node scripts/audit-check.js audit.json --allowlist some/other/file.json
 *
 * Why not plain `npm audit --audit-level=high`: it has no way to accept one advisory that does not
 * apply here, so the only way to get a green build would be to turn the check off. An allowlist entry
 * names one advisory, says why, and stops working on its expiry date. Policy: docs/SECURITY_SCANNING.md.
 *
 * Exit codes: 0 nothing to fix, 1 findings, 2 the report could not be read (npm audit itself failed).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWLIST = path.join(__dirname, 'audit-allowlist.json');
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

// "https://github.com/advisories/GHSA-vh95-rmgr-6w4m" -> "GHSA-vh95-rmgr-6w4m"
function advisoryId(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(String(url || ''));
  return match ? match[0] : null;
}

// Every advisory in the report once, however many packages it reaches. A package whose `via` is only a
// list of names is just passing another package's problem up, so only the objects are advisories.
function collectAdvisories(report) {
  const found = new Map();
  const vulnerabilities = (report && report.vulnerabilities) || {};
  Object.keys(vulnerabilities).forEach((pkg) => {
    const entry = vulnerabilities[pkg];
    (entry.via || []).forEach((via) => {
      if (!via || typeof via !== 'object') return;
      const id = advisoryId(via.url) || 'npm-' + via.source;
      if (!found.has(id)) {
        found.set(id, {
          id, severity: via.severity, title: via.title, url: via.url, range: via.range,
          package: via.name || pkg, direct: !!entry.isDirect,
          fix: entry.fixAvailable && typeof entry.fixAvailable === 'object'
            ? entry.fixAvailable.name + '@' + entry.fixAvailable.version
            : (entry.fixAvailable ? 'npm audit fix' : null)
        });
      }
    });
  });
  return Array.from(found.values());
}

// Allowlist entries are { id, reason, expires: "YYYY-MM-DD" }. Anything incomplete or past its date
// does not count, and is reported so it gets cleaned up.
function readAllowlist(file) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(data.allow) ? data.allow : [];
}

function evaluate(report, allow, options) {
  const level = (options && options.level) || 'high';
  const now = (options && options.now) || new Date();
  const problems = [];
  const active = new Set();

  (allow || []).forEach((entry) => {
    const label = 'allowlist entry ' + (entry && entry.id ? entry.id : JSON.stringify(entry));
    if (!entry || !advisoryId(entry.id) || !entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expires || ''))) {
      problems.push(label + ' needs an id (GHSA-xxxx-xxxx-xxxx), a reason and an expires date (YYYY-MM-DD)');
    } else if (Date.parse(entry.expires + 'T23:59:59Z') < now.getTime()) {
      problems.push(label + ' expired on ' + entry.expires + ': check it again, then fix the dependency or renew it with a new reason');
    } else {
      active.add(entry.id.toUpperCase());
    }
  });

  const findings = collectAdvisories(report).filter((advisory) => {
    if (!(RANK[advisory.severity] >= RANK[level])) return false;
    return !active.has(String(advisory.id).toUpperCase());
  });
  return { findings, problems, ok: !findings.length && !problems.length };
}

function describe(advisory) {
  return advisory.id + ' [' + advisory.severity + '] ' + advisory.package + ' ' + (advisory.range || '') +
    ': ' + advisory.title + ' (' + advisory.url + ')' +
    (advisory.fix ? ' | fix: ' + advisory.fix : ' | no fix published yet') +
    (advisory.direct ? ' | direct dependency' : ' | pulled in by another package');
}

function main(argv) {
  const args = argv.slice();
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    return args.splice(i, 2)[1];
  };
  const level = opt('--level', 'high');
  const allowFile = opt('--allowlist', DEFAULT_ALLOWLIST);
  const file = args[0];
  if (!file || !(level in RANK)) {
    console.error('usage: node scripts/audit-check.js <npm-audit.json> [--level high] [--allowlist file]');
    return 2;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error('Could not read ' + file + ': ' + error.message);
    return 2;
  }
  if (report.error || !report.vulnerabilities) {
    // npm audit prints { error: { code, summary } } when the registry is unreachable. That is not a pass.
    console.error('npm audit did not produce a report: ' + JSON.stringify(report.error || report).slice(0, 300));
    return 2;
  }

  const result = evaluate(report, readAllowlist(allowFile), { level });
  const onGitHub = !!process.env.GITHUB_ACTIONS;
  result.findings.forEach((advisory) => {
    console.log((onGitHub ? '::error file=package-lock.json::' : 'FOUND ') + describe(advisory));
  });
  result.problems.forEach((message) => {
    console.log((onGitHub ? '::error file=scripts/audit-allowlist.json::' : 'ALLOWLIST ') + message);
  });
  if (result.ok) {
    console.log('npm audit: no advisory at ' + level + ' or above that is not allow-listed.');
    return 0;
  }
  console.log('\n' + result.findings.length + ' advisory(ies) to fix. Steps and how to allow-list a false positive: docs/SECURITY_SCANNING.md');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { advisoryId, collectAdvisories, evaluate };
