#!/usr/bin/env node
/*
 * Post-deploy smoke check for a live RELIEF URL (Issue #117). See docs/DEPLOY_SMOKE_CHECK.md.
 *
 *   node .github/scripts/deploy-smoke-check.js --env production
 *   node .github/scripts/deploy-smoke-check.js --env preview --url https://<preview-host> --commit <sha>
 *
 * It requests a fixed list of routes, then every same-origin stylesheet, script and image
 * those pages point to, and prints one line per request: status, content type and URL.
 * Nothing but GET/HEAD requests is sent. Query strings and anything after # are never printed,
 * and a URL that contains a user name or password is refused, so a token pasted into --url
 * cannot end up in a log.
 *
 * Exit code 0 only when every route and asset answered 200 with a sensible content type.
 * Node 20 or newer (global fetch), no dependencies.
 */
'use strict';

const PRODUCTION_URL = 'https://relief-gamma.vercel.app'; // the live demo URL in README.md

// Pages a visitor (or someone in an emergency) must always be able to open without signing in.
const ROUTES = [
  '/',
  '/pages/firstaid.html',
  '/pages/ambulances.html',
  '/pages/hospitals.html',
  '/pages/doctors.html',
  '/pages/appointments.html',
  '/pages/dashboard.html',
  '/pages/symptoms.html'
];

const TYPE_FOR_EXT = {
  '.css': /^text\/css/i,
  '.js': /javascript/i,
  '.json': /json/i,
  '.html': /^text\/html/i,
  '.png': /^image\//i,
  '.jpg': /^image\//i,
  '.jpeg': /^image\//i,
  '.svg': /^image\//i,
  '.webp': /^image\//i,
  '.ico': /^image\//i
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--json') args.json = true;
    else if (/^--(env|url|commit|timeout)$/.test(a)) args[a.slice(2)] = argv[++i];
    else throw new Error('Unknown argument: ' + a);
  }
  return args;
}

// The part of a URL that is safe to print: origin + path, no credentials, query or fragment.
function printable(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

/**
 * Work out what to check from the command line.
 * Production defaults to the README live URL. A preview has to be named explicitly and must not be
 * the production host, so a preview run can never be mistaken for a production check.
 */
function resolveTarget({ env, url, commit }) {
  if (env !== 'production' && env !== 'preview') {
    throw new Error('Pass --env production or --env preview.');
  }
  const raw = url || (env === 'production' ? PRODUCTION_URL : '');
  if (!raw) throw new Error('A preview check needs --url https://<preview-host>.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error('--url is not a valid URL.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('--url must not contain a user name or password.');
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('--url must be https (http is only allowed for localhost).');
  }
  const prodHost = new URL(PRODUCTION_URL).host;
  if (env === 'preview' && parsed.host === prodHost) {
    throw new Error('--env preview was given the production host. Use --env production for ' + prodHost + '.');
  }
  if (commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new Error('--commit must be a 7 to 40 character hex SHA.');
  }
  return { env, origin: parsed.origin, commit: commit || null };
}

// Same-origin stylesheets, scripts and images referenced by a page, as absolute URLs.
function firstPartyAssets(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const found = new Set();
  const tag = /<(link|script|img)\b[^>]*>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const attrs = m[0];
    const kind = m[1].toLowerCase();
    if (kind === 'link' && !/\brel\s*=\s*["']?(stylesheet|icon|shortcut icon|manifest)/i.test(attrs)) continue;
    const ref = /\b(?:href|src)\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!ref) continue;
    const value = ref[1].trim();
    if (/^(data:|javascript:|mailto:|tel:|#)/i.test(value)) continue;
    let abs;
    try {
      abs = new URL(value, pageUrl);
    } catch (e) {
      continue;
    }
    if (abs.origin !== origin) continue; // CDNs, fonts and maps are not ours to verify
    found.add(abs.origin + abs.pathname);
  }
  return [...found];
}

// Headers vercel.json sets on every response (see docs/SECURITY_HEADERS.md). A page that arrives without them has lost its
// clickjacking and no-sniff protection, which no file check can show: the files themselves are still the right ones.
const REQUIRED_HEADERS = [
  ['content-security-policy', /frame-ancestors 'none'/i],
  ['x-content-type-options', /^nosniff$/i],
  ['x-frame-options', /^deny$/i],
  ['referrer-policy', /^strict-origin-when-cross-origin$/i]
];

/** Names of the required headers that are missing or wrong in a response, or null when all are there. */
function headerProblem(headers) {
  const h = headers || {};
  const bad = REQUIRED_HEADERS.filter(([name, want]) => !want.test(h[name] || '')).map(([name]) => name);
  return bad.length ? 'missing or wrong security header(s): ' + bad.join(', ') : null;
}

function typeProblem(url, contentType) {
  const dot = new URL(url).pathname.match(/\.[a-z0-9]+$/i);
  const expected = dot && TYPE_FOR_EXT[dot[0].toLowerCase()];
  if (expected && !expected.test(contentType || '')) {
    return 'unexpected content type "' + (contentType || 'none') + '"';
  }
  return null;
}

async function request(url, timeoutMs, method) {
  const started = Date.now();
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const text = method === 'GET' ? await res.text() : '';
    return {
      status: res.status,
      type: (res.headers.get('content-type') || '').split(';')[0],
      finalUrl: res.url,
      ms: Date.now() - started,
      headers: Object.fromEntries(REQUIRED_HEADERS.map(([name]) => [name, res.headers.get(name) || ''])),
      text
    };
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { status: 0, type: '', finalUrl: url, ms: Date.now() - started, text: '', error: timedOut ? 'timed out' : 'network error' };
  }
}

function judge(result, origin, kind, checkHeaders) {
  if (result.error) return result.error;
  if (result.status !== 200) return 'status ' + result.status;
  if (new URL(result.finalUrl).origin !== origin) return 'redirected to another host (' + new URL(result.finalUrl).host + ')';
  if (kind === 'route' && !/^text\/html/i.test(result.type)) return 'unexpected content type "' + (result.type || 'none') + '"';
  if (kind === 'route') return checkHeaders ? headerProblem(result.headers) : null;
  return typeProblem(result.finalUrl, result.type);
}

// Security headers are only expected from the real host: a local preview server (python -m http.server) sends none.
async function runCheck(target, { timeoutMs = 10000, concurrency = 6, checkHeaders = /^https:/i.test(target.origin) } = {}) {
  const rows = [];
  const assetSources = new Map(); // asset url -> first page that mentioned it
  const record = (kind, url, result, problem, from) =>
    rows.push({ kind, url: printable(url), status: result.status, type: result.type, ms: result.ms, ok: !problem, problem: problem || null, from: from || null });

  for (const route of ROUTES) {
    const url = target.origin + route;
    const result = await request(url, timeoutMs, 'GET');
    const problem = judge(result, target.origin, 'route', checkHeaders);
    record('route', url, result, problem);
    if (!problem) {
      firstPartyAssets(result.text, result.finalUrl).forEach((a) => {
        if (!assetSources.has(a)) assetSources.set(a, route);
      });
    }
  }

  const queue = [...assetSources.entries()];
  async function worker() {
    while (queue.length) {
      const [url, from] = queue.shift();
      let result = await request(url, timeoutMs, 'HEAD');
      if (result.status === 405 || result.status === 501) result = await request(url, timeoutMs, 'GET');
      record('asset', url, result, judge(result, target.origin, 'asset'), from);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  return {
    env: target.env,
    origin: target.origin,
    intendedCommit: target.commit,
    checkedAt: new Date().toISOString(),
    rows,
    failed: rows.filter((r) => !r.ok).length
  };
}

function formatReport(report) {
  const lines = [];
  lines.push('RELIEF deployment smoke check');
  lines.push('environment: ' + report.env);
  lines.push('url:         ' + report.origin);
  lines.push('commit:      ' + (report.intendedCommit ? report.intendedCommit + ' (intended, NOT verified by this script)' : 'not given'));
  lines.push('checked at:  ' + report.checkedAt);
  lines.push('');
  ['route', 'asset'].forEach((kind) => {
    const rows = report.rows.filter((r) => r.kind === kind);
    lines.push(kind === 'route' ? 'Routes (' + rows.length + ')' : 'First-party assets (' + rows.length + ')');
    rows.sort((a, b) => a.url.localeCompare(b.url)).forEach((r) => {
      lines.push(
        (r.ok ? '  ok   ' : '  FAIL ') + String(r.status || '---').padEnd(4) + (r.type || '-').padEnd(26) + r.url +
          (r.problem ? '   <- ' + r.problem + (r.from ? ' (used by ' + r.from + ')' : '') : '')
      );
    });
    lines.push('');
  });
  lines.push(report.failed ? 'RESULT: FAILED, ' + report.failed + ' problem(s)' : 'RESULT: all ' + report.rows.length + ' requests answered as expected');
  lines.push('This only proves the deployed files are being served. It is not a check of the SOS, location or form behaviour; do the manual list in docs/DEPLOY_SMOKE_CHECK.md for that.');
  return lines.join('\n');
}

const HELP = [
  'Usage: node .github/scripts/deploy-smoke-check.js --env <production|preview> [--url <https url>] [--commit <sha>] [--timeout <ms>] [--json]',
  '  --env      production (default URL: ' + PRODUCTION_URL + ') or preview (needs --url, must not be the production host)',
  '  --commit   the commit you intend to be live; printed in the report, not verified',
  '  --json     print the report as JSON instead of text'
].join('\n');

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      console.log(HELP);
      return 0;
    }
    const target = resolveTarget(args);
    const report = await runCheck(target, { timeoutMs: Number(args.timeout) > 0 ? Number(args.timeout) : 10000 });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.failed ? 1 : 0;
  } catch (e) {
    console.error(e.message + '\n\n' + HELP);
    return 2;
  }
}

module.exports = { ROUTES, PRODUCTION_URL, REQUIRED_HEADERS, parseArgs, printable, resolveTarget, firstPartyAssets, typeProblem, headerProblem, runCheck, formatReport };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
