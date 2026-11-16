// Counts requests and transferred bytes for a few pages, so before/after numbers in a pull request
// are measured the same way. See docs/PAGE_WEIGHT.md.
//
//   node e2e/static-server.js 4173 &        (or any server for the repository root)
//   node scripts/measure-page-weight.js [baseURL] [--external] [--scroll] [paths...]
//
// Headless Chromium at 375px wide. By default requests to other hosts (icon font, Google Fonts, Leaflet)
// are blocked so the numbers do not depend on a CDN. --external lets them through. --scroll scrolls to the
// bottom first, so lazy pictures are counted too. Bytes are the body size Chrome reports
// (Network.loadingFinished), so they are compressed if the server compresses and not otherwise.
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const external = args.includes('--external');
const scroll = args.includes('--scroll');
const rest = args.filter((a) => !a.startsWith('--'));
const base = rest[0] && /^https?:/.test(rest[0]) ? rest.shift() : 'http://127.0.0.1:4173';
const paths = rest.length ? rest : ['/index.html', '/pages/hospitals.html', '/pages/ambulances.html'];

(async () => {
  const browser = await chromium.launch(process.env.RELIEF_CHROMIUM_PATH ? { executablePath: process.env.RELIEF_CHROMIUM_PATH } : {});
  try {
    for (const p of paths) {
      const context = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: 'en-IN' });
      const origin = new URL(base).origin;
      if (!external) await context.route((u) => u.origin !== origin && /^https?:$/.test(u.protocol), (r) => r.abort());
      await context.addInitScript(() => {
        try { localStorage.setItem('relief_onboarding_status', JSON.stringify({ status: 'skipped', timestamp: 0 })); } catch (e) { /* blocked */ }
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      const seen = new Map();
      cdp.on('Network.requestWillBeSent', (e) => seen.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0 }));
      cdp.on('Network.loadingFinished', (e) => { const r = seen.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
      await page.goto(base + p, { waitUntil: 'load' });
      // The home page shows a splash screen first and fills in the page behind it, so wait for the page itself.
      await page.locator('.main-content').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      if (scroll) {
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        });
        await page.waitForTimeout(1000); // networkidle has already fired once, so give the late pictures a moment
        await page.waitForLoadState('networkidle').catch(() => {});
      }
      const list = [...seen.values()].filter((r) => /^https?:/.test(r.url));
      const byType = {};
      list.forEach((r) => { byType[r.type] = byType[r.type] || { requests: 0, bytes: 0 }; byType[r.type].requests++; byType[r.type].bytes += r.bytes; });
      const total = list.reduce((sum, r) => sum + r.bytes, 0);
      console.log(p + ': ' + list.length + ' requests, ' + total + ' bytes');
      Object.keys(byType).sort().forEach((t) => console.log('  ' + t + ': ' + byType[t].requests + ' requests, ' + byType[t].bytes + ' bytes'));
      list.sort((a, b) => b.bytes - a.bytes).slice(0, Number(process.env.TOP || 5)).forEach((r) => console.log('  biggest: ' + r.url.replace(base, '') + ' ' + r.bytes));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})();
