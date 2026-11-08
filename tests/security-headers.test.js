/**
 * Tests for the Content Security Policy and browser security headers (Issue #59).
 * Run with: node --test tests/security-headers.test.js
 *
 * What this cannot do: it does not run a browser. The policy was checked in a real
 * browser by hand (see docs/SECURITY_HEADERS.md). These tests keep the pieces that
 * must agree from drifting apart: the policy in every page, the policy in vercel.json,
 * and what the pages really load.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const pageFiles = ['index.html']
  .concat(fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f))
  .filter((f) => read(f).trim() !== '');          // pages/home.html is an empty file
const jsFiles = fs.readdirSync(path.join(ROOT, 'assets', 'js')).filter((f) => f.endsWith('.js')).map((f) => 'assets/js/' + f)
  .concat(fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((d) => fs.readdirSync(path.join(ROOT, 'profiles', d.name)).filter((f) => f.endsWith('.js')).map((f) => 'profiles/' + d.name + '/' + f)));

// ---- helpers ----

function parsePolicy(text) {
  const out = {};
  text.split(';').map((s) => s.trim()).filter(Boolean).forEach((part) => {
    const [name, ...sources] = part.split(/\s+/);
    assert.ok(!(name.toLowerCase() in out), 'directive twice: ' + name);
    out[name.toLowerCase()] = sources;
  });
  return out;
}

// Does one CSP source expression allow this absolute URL? (scheme, host, *. wildcard and path rules)
function sourceAllows(source, url) {
  const u = new URL(url);
  if (source === "'self'") return false;                 // only relative URLs are same-origin here
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return u.protocol === source.toLowerCase();
  const m = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^/:]+|[^/:*]+)(?::(\d+|\*))?(\/.*)?$/i);
  if (!m) return false;
  const [, scheme, host, port, srcPath] = m;
  if (scheme && scheme.toLowerCase() !== u.protocol.replace(':', '')) return false;
  if (!scheme && !['http:', 'https:'].includes(u.protocol)) return false;
  if (host.startsWith('*.')) { if (!u.hostname.endsWith(host.slice(1))) return false; }
  else if (host !== '*' && host.toLowerCase() !== u.hostname) return false;
  if (port && port !== '*' && port !== (u.port || (u.protocol === 'https:' ? '443' : '80'))) return false;
  if (srcPath) {
    if (srcPath.endsWith('/')) return u.pathname.startsWith(srcPath);
    return u.pathname === srcPath;
  }
  return true;
}

function allowed(policy, directive, url) {
  const sources = policy[directive] || policy['default-src'] || [];
  return sources.some((s) => sourceAllows(s, url));
}

const metaRe = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i;
const vercel = JSON.parse(read('vercel.json'));
const headerList = vercel.headers[0].headers;
const header = (name) => (headerList.find((h) => h.key.toLowerCase() === name.toLowerCase()) || {}).value;
const headerPolicy = parsePolicy(header('Content-Security-Policy'));
const metaText = read('index.html').match(metaRe)[1];
const policy = parsePolicy(metaText);

// ---- the policy in the pages ----

test('every page carries the same single CSP meta tag, placed before anything it should govern', () => {
  assert.ok(pageFiles.length >= 26, 'found ' + pageFiles.length + ' pages');
  pageFiles.forEach((f) => {
    const html = read(f);
    assert.strictEqual((html.match(/http-equiv="Content-Security-Policy"/gi) || []).length, 1, f + ' needs exactly one CSP meta');
    const m = html.match(metaRe);
    assert.ok(m, f + ': meta not in the expected form');
    assert.strictEqual(m[1], metaText, f + ' has a different policy from index.html');
    const at = html.search(metaRe);
    const firstResource = html.search(/<(script|link|style|img|iframe)\b/i);
    assert.ok(firstResource === -1 || at < firstResource, f + ': the meta tag must come before the first script, link or style');
    assert.ok(html.search(/<head[\s>]/i) < at && at < html.indexOf('</head>'), f + ': meta must be inside <head>');
    assert.strictEqual((html.match(/<!doctype/gi) || []).length, 1, f + ' should have exactly one doctype');
    assert.strictEqual((html.match(/<html[\s>]/gi) || []).length, 1, f + ' should have exactly one <html>');
    assert.strictEqual((html.match(/<head[\s>]/gi) || []).length, 1, f + ' should have exactly one <head>');
    assert.ok(html.search(/<meta charset=/i) < at, f + ': charset meta should stay first');
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/, f + ' needs the referrer meta');
  });
});

test('the meta policy only uses directives a meta tag supports', () => {
  ['frame-ancestors', 'report-uri', 'report-to', 'sandbox'].forEach((d) => {
    assert.ok(!(d in policy), d + ' is ignored in a meta tag, set it as a header (vercel.json) instead');
  });
});

test('vercel.json sends the same policy as the pages, plus frame-ancestors', () => {
  const extra = Object.assign({}, headerPolicy);
  assert.deepStrictEqual(extra['frame-ancestors'], ["'none'"]);
  delete extra['frame-ancestors'];
  assert.deepStrictEqual(extra, policy);
});

test('vercel.json sets the other security headers', () => {
  assert.strictEqual(header('X-Content-Type-Options'), 'nosniff');
  assert.strictEqual(header('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.strictEqual(header('X-Frame-Options'), 'DENY');
  const pp = header('Permissions-Policy');
  assert.match(pp, /geolocation=\(self\)/, 'the SOS and location features need geolocation');
  ['camera', 'microphone', 'payment', 'usb'].forEach((f) => assert.match(pp, new RegExp(f + '=\\(\\)')));
  assert.strictEqual(vercel.headers[0].source, '/(.*)');
});

// ---- how strict it is ----

test('no script can run from inline code, eval or a whole CDN', () => {
  const script = policy['script-src'];
  assert.ok(script, 'script-src must be set');
  ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", '*', 'https:', 'http:', 'data:', 'blob:'].forEach((bad) => {
    assert.ok(!script.includes(bad), 'script-src must not contain ' + bad);
  });
  script.forEach((s) => {
    if (s === "'self'") return;
    assert.match(s, /^https:\/\/[a-z.]+\/[^*]*\.js$/, 'script source must be one exact file, not an origin: ' + s);
  });
});

test('base, object and form targets are locked down; the only unsafe keyword is the documented style one', () => {
  assert.deepStrictEqual(policy['object-src'], ["'none'"]);
  assert.deepStrictEqual(policy['base-uri'], ["'self'"]);
  assert.deepStrictEqual(policy['form-action'], ["'self'"]);
  assert.deepStrictEqual(policy['default-src'], ["'self'"]);
  const unsafe = [];
  Object.keys(policy).forEach((d) => policy[d].forEach((s) => { if (/unsafe/.test(s)) unsafe.push(d + ' ' + s); }));
  assert.deepStrictEqual(unsafe, ["style-src 'unsafe-inline'"]);
  Object.keys(policy).forEach((d) => {
    ['*', 'https:', 'http:'].forEach((wide) => assert.ok(!policy[d].includes(wide), d + ' allows ' + wide));
  });
});

// ---- what the pages really use must be allowed, and nothing more is allowed than is used ----

const urlRe = /(?:src|href|action)\s*=\s*"(https?:\/\/[^"]+)"/gi;

function externalRefs(file) {
  const html = read(file);
  const refs = [];
  let m;
  while ((m = urlRe.exec(html)) !== null) {
    const tag = html.slice(html.lastIndexOf('<', m.index), m.index).match(/<([a-z0-9]+)/i);
    refs.push({ tag: tag ? tag[1].toLowerCase() : '?', url: m[1], rel: (html.slice(m.index - 200, m.index + 300).match(/rel="([^"]+)"/i) || [])[1] });
  }
  return refs;
}

const DIRECTIVE_FOR = (r) => {
  if (r.tag === 'script') return 'script-src';
  if (r.tag === 'link' && /stylesheet/i.test(r.rel || '')) return 'style-src';
  if (r.tag === 'img') return 'img-src';
  if (r.tag === 'iframe') return 'frame-src';
  return null;                                         // plain <a href> and <link rel="preconnect"> are not fetched content
};

test('every external script, stylesheet, image and frame in the pages is allowed by the policy', () => {
  let checked = 0;
  pageFiles.forEach((f) => externalRefs(f).forEach((r) => {
    const directive = DIRECTIVE_FOR(r);
    if (!directive) return;
    checked++;
    if (f === 'index.html' && /amity\.edu/.test(r.url)) return;   // dead hotlink, deliberately not allowed, see docs
    assert.ok(allowed(policy, directive, r.url), f + ': ' + directive + ' does not allow ' + r.url);
  }));
  assert.ok(checked >= 25, 'expected to find many references, found ' + checked);
});

test('the dead hotlinked photo is the only page resource the policy refuses', () => {
  assert.ok(!allowed(policy, 'img-src', 'https://www.amity.edu/gurugram/microbackoffice/Uploads/TestimonialImage/98testi_RajivBasavaalumni.jpg'));
  assert.ok(!allowed(policy, 'img-src', 'https://backoffice.amity.edu/x.jpg'));
});

test('the origins the scripts fetch from at run time are allowed', () => {
  const loc = read('assets/js/location-service.js');
  assert.match(loc, /https:\/\/nominatim\.openstreetmap\.org/);
  assert.ok(allowed(policy, 'connect-src', 'https://nominatim.openstreetmap.org/search?q=x&format=json'));
  ['hospitals', 'pharmacies', 'ambulances'].forEach((n) => {
    assert.match(read('assets/js/' + n + '.js'), /https:\/\/\{s\}\.tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  });
  ['a', 'b', 'c'].forEach((s) => assert.ok(allowed(policy, 'img-src', 'https://' + s + '.tile.openstreetmap.org/7/90/55.png')));
  assert.ok(allowed(policy, 'img-src', 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png'));
  const i18n = read('assets/js/i18n.js');
  const font = i18n.match(/FONT_URL = '([^']+)'/)[1];
  assert.ok(allowed(policy, 'style-src', font), 'the Bengali font stylesheet');
  assert.ok(allowed(policy, 'font-src', 'https://fonts.gstatic.com/s/notosansbengali/v1/x.woff2'));
  assert.ok(allowed(policy, 'font-src', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2'));
  assert.ok(allowed(policy, 'frame-src', 'https://www.google.com/maps/embed?pb=!1m18'));
  assert.ok(!allowed(policy, 'frame-src', 'https://www.google.com/other'));
});

test('things the policy must keep out', () => {
  assert.ok(!allowed(policy, 'script-src', 'https://unpkg.com/some-other-package@1.0.0/x.js'), 'unpkg serves any npm package, only the one file is allowed');
  assert.ok(!allowed(policy, 'script-src', 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js'));
  assert.ok(!allowed(policy, 'connect-src', 'https://evil.example/steal'));
  assert.ok(!allowed(policy, 'img-src', 'https://evil.example/pixel.gif'));
  assert.ok(!allowed(policy, 'frame-src', 'https://evil.example/'));
  assert.ok(!allowed(policy, 'connect-src', 'http://localhost:5005/webhooks/rest/webhook'), 'the Rasa URL in api.js is not used by any page');
});

test('the policy does not list origins nothing uses', () => {
  const used = [];
  pageFiles.forEach((f) => externalRefs(f).forEach((r) => { if (DIRECTIVE_FOR(r)) used.push(r.url); }));
  const text = Object.keys(policy).map((d) => d + ' ' + policy[d].join(' ')).join(' ');
  const hosts = new Set((text.match(/https:\/\/[^\s/;]+/g) || []));
  const runtime = ['https://nominatim.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'];
  hosts.forEach((h) => {
    const ok = used.some((u) => sourceAllows(h, u) || new URL(u).origin === h) || runtime.includes(h) ||
      used.some((u) => u.startsWith(h));
    assert.ok(ok, h + ' is in the policy but nothing in the pages uses it');
  });
});

// ---- code that a strict script-src would break ----

test('no page has an inline script, an inline event handler or a javascript: link', () => {
  pageFiles.forEach((f) => {
    const html = read(f);
    (html.match(/<script\b[^>]*>/gi) || []).forEach((tag) => {
      assert.match(tag, /\ssrc="/i, f + ' has an inline script: ' + tag);
    });
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, f + ' has an inline event handler');
    assert.doesNotMatch(html, /href\s*=\s*["']\s*javascript:/i, f + ' has a javascript: link');
    assert.doesNotMatch(html, /<base\b/i, f + ' has a <base> tag');
  });
});

test('no script builds inline handlers, eval, string timers or document.write', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  jsFiles.forEach((f) => {
    const code = strip(read(f));
    assert.doesNotMatch(code, /\son(click|load|error|change|submit|input|focus|blur|mouse\w+|key\w+)\s*=\s*["']/i, f + ' builds an inline handler');
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/, f + ' uses eval, Function or document.write');
    assert.doesNotMatch(code, /set(Timeout|Interval)\s*\(\s*["'`]/, f + ' passes a string to a timer');
    assert.doesNotMatch(code, /javascript:/i, f + ' has a javascript: URL');
  });
});

test('every external script and stylesheet from a CDN has an integrity hash and anonymous CORS', () => {
  let n = 0;
  pageFiles.forEach((f) => {
    const html = read(f);
    (html.match(/<(?:script|link)\b[^>]*(?:unpkg\.com|cdnjs\.cloudflare\.com)[^>]*>/gi) || []).forEach((tag) => {
      n++;
      assert.match(tag, /integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, f + ': ' + tag);
      assert.match(tag, /crossorigin="anonymous"/, f + ': ' + tag);
    });
  });
  assert.ok(n >= 19, 'found ' + n);
});

test('the same file has the same integrity hash on every page', () => {
  const seen = {};
  pageFiles.forEach((f) => {
    const html = read(f);
    (html.match(/<(?:script|link)\b[^>]*(?:unpkg\.com|cdnjs\.cloudflare\.com)[^>]*>/gi) || []).forEach((tag) => {
      const url = tag.match(/(?:href|src)="([^"]+)"/)[1];
      const hash = tag.match(/integrity="([^"]+)"/)[1];
      assert.strictEqual(seen[url] || hash, hash, url + ' has two different hashes');
      seen[url] = hash;
    });
  });
  assert.strictEqual(Object.keys(seen).length, 4);
});

// ---- the matcher itself ----

test('the policy matcher used above behaves like a browser for the cases that matter', () => {
  const p = parsePolicy("default-src 'self'; script-src 'self' https://a.example/x.js; img-src https://*.t.example https://b.example/img/");
  assert.ok(allowed(p, 'script-src', 'https://a.example/x.js?v=1'));
  assert.ok(!allowed(p, 'script-src', 'https://a.example/y.js'));
  assert.ok(!allowed(p, 'script-src', 'http://a.example/x.js'));
  assert.ok(allowed(p, 'img-src', 'https://a.t.example/1.png'));
  assert.ok(!allowed(p, 'img-src', 'https://t.example/1.png'));
  assert.ok(allowed(p, 'img-src', 'https://b.example/img/dir/1.png'));
  assert.ok(!allowed(p, 'img-src', 'https://b.example/other/1.png'));
  assert.ok(!allowed(p, 'font-src', 'https://a.example/f.woff2'));
});
