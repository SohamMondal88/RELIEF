// Tiny static file server for the e2e tests. Node only, no dependencies, so the
// tests run the same way on Linux, macOS and Windows.
// Usage: node e2e/static-server.js [port] [--clean-urls]   (serves the repository root)
//
// --clean-urls (or CLEAN_URLS=1) behaves like "cleanUrls": true in vercel.json, which is what the live site
// does: /pages/firstaid.html answers 308 to /pages/firstaid, and /pages/firstaid serves pages/firstaid.html.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 4173);
const CLEAN_URLS = args.includes('--clean-urls') || process.env.CLEAN_URLS === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  let pathname;
  let search;
  try {
    const parsed = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(parsed.pathname);
    search = parsed.search;
  } catch (e) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (CLEAN_URLS) {
    if (pathname.endsWith('.html')) {
      // Same as Vercel: the .html address redirects to the clean one (/index.html to /).
      const clean = pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
      res.writeHead(308, { Location: (clean || '/') + search, 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (!pathname.endsWith('/') && !path.extname(pathname)) pathname += '.html';
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.normalize(path.join(ROOT, pathname));
  // Never serve anything outside the repository, or the dependency folder.
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(path.join(ROOT, 'node_modules') + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Serving ' + ROOT + ' on http://127.0.0.1:' + PORT + (CLEAN_URLS ? ' (clean URLs)' : ''));
});
