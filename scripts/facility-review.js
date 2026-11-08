#!/usr/bin/env node
/**
 * Maintainer tool for the facility verification workflow.
 * Policy: docs/FACILITY_VERIFICATION_POLICY.md. Logic: assets/js/facility-review.js.
 *
 *   node scripts/facility-review.js summary
 *   node scripts/facility-review.js list [--json] [--limit N] [--max-age DAYS]
 *   node scripts/facility-review.js record <id> --state verified --by <name> --source <text> [--date YYYY-MM-DD] [--note <text>]
 *   node scripts/facility-review.js record <id> --state stale|rejected|pending --by <name> --note <why>
 *   node scripts/facility-review.js check [--base-ref origin/main | --base <file>]
 *
 * Options for every command: --file <path> (default assets/data/facilities.json), --now YYYY-MM-DD (for testing).
 * "record" is the only command that writes, and it only appends to a record's reviewLog.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const U = require('../assets/js/facility-utils.js');
const R = require('../assets/js/facility-review.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_FILE = path.join(ROOT, 'assets', 'data', 'facilities.json');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.flags[key] = true;
      else { out.flags[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fail('Could not read ' + file + ': ' + e.message);
  }
}

function dateOption(flags) {
  if (flags.now === undefined) return undefined;
  if (U.parseDay(String(flags.now)) === null) fail('--now must be a date like 2026-10-27');
  return Date.parse(flags.now + 'T12:00:00Z');
}

function statusOptions(data, flags) {
  const policy = U.getReviewPolicy(data);
  if (flags['max-age'] !== undefined) {
    const n = Number(flags['max-age']);
    if (!Number.isInteger(n) || n < 1) fail('--max-age must be a whole number of days');
    policy.maxAgeDays = n;
    policy.byType = {};
  }
  return { policy: policy, now: dateOption(flags) };
}

function pad(value, width) {
  const s = String(value == null ? '' : value);
  return s.length >= width ? s.slice(0, width - 1) + ' ' : s + ' '.repeat(width - s.length);
}

function cmdSummary(args) {
  const data = load(args.flags.file || DEFAULT_FILE);
  const opts = statusOptions(data, args.flags);
  const counts = R.summary(U.normalizeFacilities(data), opts);
  console.log('Facilities: ' + counts.total + '   (stale after ' + opts.policy.maxAgeDays + ' days)');
  ['verified', 'stale', 'pending', 'rejected'].forEach((k) => console.log('  ' + pad(k, 10) + counts[k]));
}

function cmdList(args) {
  const data = load(args.flags.file || DEFAULT_FILE);
  const opts = statusOptions(data, args.flags);
  let items = R.queue(U.normalizeFacilities(data), opts);
  const total = items.length;
  if (args.flags.limit !== undefined) {
    const n = Number(args.flags.limit);
    if (!Number.isInteger(n) || n < 1) fail('--limit must be a whole number');
    items = items.slice(0, n);
  }
  if (args.flags.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  console.log('Needs a check: ' + total + ' (stale first, then pending, oldest check first)');
  if (!items.length) return;
  console.log(pad('ID', 9) + pad('STATE', 9) + pad('LAST CHECKED', 14) + pad('AGE', 6) + pad('TYPE', 11) + 'NAME');
  items.forEach((i) => {
    console.log(pad(i.id, 9) + pad(i.state, 9) + pad(i.lastChecked || 'never', 14) + pad(i.ageDays == null ? '-' : i.ageDays + 'd', 6) + pad(i.type, 11) + i.name);
  });
}

function cmdRecord(args) {
  const id = args._[1];
  if (!id) fail('Usage: record <id> --state <state> --by <name> [--source <text>] [--date YYYY-MM-DD] [--note <text>]');
  const file = args.flags.file || DEFAULT_FILE;
  const data = load(file);
  const index = (data.facilities || []).findIndex((f) => f && f.id === id);
  if (index === -1) fail('No facility with id ' + id);
  const flag = (k) => (typeof args.flags[k] === 'string' ? args.flags[k] : '');
  const result = R.applyReview(data.facilities[index], {
    state: flag('state'), by: flag('by'), source: flag('source'), date: flag('date'), note: flag('note')
  }, { now: dateOption(args.flags) });
  if (!result.ok) {
    result.errors.forEach((e) => console.error('- ' + e));
    process.exit(1);
  }
  data.facilities[index] = result.record;
  const problems = R.validateRecord(result.record, { now: dateOption(args.flags) });
  if (problems.length) {
    problems.forEach((p) => console.error('- ' + p));
    fail('Not written: the result would not pass the checks.');
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(id + ': ' + result.entry.from + ' -> ' + result.entry.to + ' (' + result.entry.by + ', ' + result.entry.date + ')');
  console.log('Commit the change in the same pull request as any edit to the details of this facility.');
}

function cmdCheck(args) {
  const file = args.flags.file || DEFAULT_FILE;
  const data = load(file);
  let problems = R.validateFile(data, { now: dateOption(args.flags) });
  let base = null;
  if (typeof args.flags['base-ref'] === 'string') {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    try {
      base = JSON.parse(execFileSync('git', ['show', args.flags['base-ref'] + ':' + rel], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      fail('Could not read ' + rel + ' from ' + args.flags['base-ref'] + ' (' + String(e.message).split('\n')[0] + ')');
    }
  } else if (typeof args.flags.base === 'string') {
    base = load(args.flags.base);
  }
  if (base) problems = problems.concat(R.compareFiles(base, data));
  if (problems.length) {
    problems.forEach((p) => console.error('- ' + p));
    fail(problems.length + ' problem(s).');
  }
  console.log('OK: ' + data.facilities.length + ' records' + (base ? ', changes since the base are allowed' : '') + '.');
}

const args = parseArgs(process.argv.slice(2));
const commands = { summary: cmdSummary, list: cmdList, record: cmdRecord, check: cmdCheck };
const run = commands[args._[0]];
if (!run) fail('Commands: summary, list, record, check. See the comment at the top of scripts/facility-review.js.');
run(args);
