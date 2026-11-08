/**
 * Tests for .github/scripts/deploy-smoke-check.js (Issue #117).
 * The script is pointed at a throwaway local server, never at the real site.
 *
 * node --test tests/deploy-smoke-check.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const S = require('../.github/scripts/deploy-smoke-check.js');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port }));
  });
}

const PAGE = '<link rel="stylesheet" href="/assets/css/style.css?v=secret-token"><script src="../assets/js/main.js"></script>';

// A healthy site: every route is html, css and js come back with the right type.
function healthy(overrides) {
  return (req, res) => {
    const path = req.url.split('?')[0];
    if (overrides && overrides[path]) return overrides[path](req, res);
    if (path === '/' || path.endsWith('.html')) return res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);
    if (path.endsWith('.css')) return res.writeHead(200, { 'Content-Type': 'text/css' }).end('a{}');
    if (path.endsWith('.js')) return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('1');
    res.writeHead(404).end('no');
  };
}

test('resolveTarget needs an env and keeps preview and production apart', () => {
  assert.throws(() => S.resolveTarget({}), /--env/);
  assert.throws(() => S.resolveTarget({ env: 'staging' }), /--env/);
  assert.throws(() => S.resolveTarget({ env: 'preview' }), /needs --url/);
  assert.throws(() => S.resolveTarget({ env: 'preview', url: S.PRODUCTION_URL }), /production host/);
  assert.strictEqual(S.resolveTarget({ env: 'production' }).origin, S.PRODUCTION_URL);
  assert.strictEqual(S.resolveTarget({ env: 'preview', url: 'https://relief-git-x.vercel.app/some/path?a=1' }).origin, 'https://relief-git-x.vercel.app');
});

test('resolveTarget refuses credentials, plain http and bad commits', () => {
  assert.throws(() => S.resolveTarget({ env: 'preview', url: 'https://user:pw@example.vercel.app' }), /user name or password/);
  assert.throws(() => S.resolveTarget({ env: 'preview', url: 'http://example.vercel.app' }), /https/);
  assert.doesNotThrow(() => S.resolveTarget({ env: 'preview', url: 'http://127.0.0.1:4173' }));
  assert.throws(() => S.resolveTarget({ env: 'production', commit: 'not-a-sha' }), /--commit/);
  assert.strictEqual(S.resolveTarget({ env: 'production', commit: '4f2dcb4' }).commit, '4f2dcb4');
});

test('printable drops query string and fragment', () => {
  assert.strictEqual(S.printable('https://a.example/x/y.css?token=abc#frag'), 'https://a.example/x/y.css');
});

test('firstPartyAssets keeps own css, js and images and skips CDNs, data urls and other links', () => {
  const html = [
    '<link rel="stylesheet" href="../assets/css/style.css">',
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/x.css">',
    '<link rel="canonical" href="https://relief.example/pages/a.html">',
    '<script src="/assets/js/main.js?v=2"></script>',
    '<script>var inline = 1;</script>',
    '<img src="data:image/png;base64,AAAA"><img src="../assets/images/logo.jpg">',
    '<a href="/pages/other.html">not an asset</a>'
  ].join('\n');
  assert.deepStrictEqual(
    S.firstPartyAssets(html, 'https://relief.example/pages/a.html').sort(),
    [
      'https://relief.example/assets/css/style.css',
      'https://relief.example/assets/images/logo.jpg',
      'https://relief.example/assets/js/main.js'
    ]
  );
});

test('typeProblem flags html served for a script or stylesheet', () => {
  assert.ok(S.typeProblem('https://a.example/a.js', 'text/html'));
  assert.ok(S.typeProblem('https://a.example/a.css', ''));
  assert.strictEqual(S.typeProblem('https://a.example/a.js', 'application/javascript'), null);
  assert.strictEqual(S.typeProblem('https://a.example/logo.jpg', 'image/jpeg'), null);
});

test('a healthy site passes and the report never prints a query string', async () => {
  const { server, origin } = await serve(healthy());
  try {
    const report = await S.runCheck(S.resolveTarget({ env: 'preview', url: origin }), { timeoutMs: 3000 });
    assert.strictEqual(report.failed, 0);
    assert.strictEqual(report.rows.filter((r) => r.kind === 'route').length, S.ROUTES.length);
    const text = S.formatReport(report);
    assert.match(text, /RESULT: all \d+ requests answered as expected/);
    assert.doesNotMatch(text, /secret-token/);
    assert.match(text, /environment: preview/);
  } finally {
    server.close();
  }
});

test('a missing first-party asset fails the run and names the page that used it', async () => {
  const { server, origin } = await serve(healthy({ '/assets/js/main.js': (req, res) => res.writeHead(404).end('no') }));
  try {
    const report = await S.runCheck(S.resolveTarget({ env: 'preview', url: origin }), { timeoutMs: 3000 });
    const bad = report.rows.filter((r) => !r.ok);
    assert.strictEqual(bad.length, 1);
    assert.strictEqual(bad[0].status, 404);
    assert.ok(bad[0].from, 'the page that referenced the asset is recorded');
    assert.match(S.formatReport(report), /FAIL 404.*main\.js.*used by/);
  } finally {
    server.close();
  }
});

test('a route that is not found fails, and a single-page fallback (html for a js file) is caught', async () => {
  const { server, origin } = await serve(
    healthy({
      '/pages/hospitals.html': (req, res) => res.writeHead(404).end('no'),
      '/assets/css/style.css': (req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>')
    })
  );
  try {
    const report = await S.runCheck(S.resolveTarget({ env: 'preview', url: origin }), { timeoutMs: 3000 });
    const bad = report.rows.filter((r) => !r.ok).map((r) => r.url.replace(origin, ''));
    assert.deepStrictEqual(bad.sort(), ['/assets/css/style.css', '/pages/hospitals.html']);
  } finally {
    server.close();
  }
});

test('a server that does not answer is reported, not hung on', async () => {
  const { server, origin } = await serve(() => {}); // never responds
  try {
    const report = await S.runCheck(S.resolveTarget({ env: 'preview', url: origin }), { timeoutMs: 200 });
    assert.strictEqual(report.failed, S.ROUTES.length);
    assert.ok(report.rows.every((r) => r.problem === 'timed out'));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
