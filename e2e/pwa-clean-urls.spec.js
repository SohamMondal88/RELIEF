// Journey: the service worker on a host that serves clean URLs, like the live site (cleanUrls in vercel.json, issue #186).
// playwright.config.js runs this spec in its own project against `node e2e/static-server.js <port> --clean-urls`,
// where /pages/firstaid.html answers 308 to /pages/firstaid, so the saved pages and the offline page are reached the
// way they are on Vercel. The other specs use the plain server and only ever see the .html addresses.
const { test, expect } = require('./fixtures');

// Same known bugs as pwa.spec.js (session-guard.js and api.js errors on main), none of these checks depend on them.
test.use({ allowedPageErrors: [[/Illegal invocation/, /deleteAccount is not defined/, /ReliefAPI is not defined/], { option: true }] });

const cacheEntries = (page) => page.evaluate(async () => {
  const out = [];
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      out.push({ path: new URL(request.url).pathname, status: response.status });
    }
  }
  return out;
});

// Chromium restarts an idle service worker between navigations and the new one is not under the offline emulation,
// so switching offline on again right before a navigation makes its fetch fail like a real lost connection.
async function goOfflineAgain(context) {
  await context.setOffline(false);
  await context.setOffline(true);
}

// Opens the first aid page the way a visitor does (the .html address, which the server redirects) until the worker
// controls the page and has filled its cache.
async function visitOnline(page) {
  await page.goto('/pages/firstaid.html');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(async () => (await cacheEntries(page)).length).toBeGreaterThan(20);
}

test.describe('service worker with clean URLs', () => {
  test('the test server behaves like Vercel: the .html address redirects to the clean one', async ({ page, baseURL }) => {
    const res = await page.request.get(baseURL + '/pages/firstaid.html?x=1', { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toBe('/pages/firstaid?x=1');
    expect((await page.request.get(baseURL + '/pages/firstaid')).status()).toBe(200);
    await page.goto('/pages/firstaid.html');
    await expect(page).toHaveURL(/\/pages\/firstaid$/);
  });

  test('a page opened at its clean address still opens offline, on reload and by either address', async ({ page, context }) => {
    await visitOnline(page);
    await expect(page).toHaveURL(/\/pages\/firstaid$/);
    await goOfflineAgain(context);
    await page.reload();
    await expect(page).toHaveURL(/\/pages\/firstaid$/);
    await expect(page.locator('.guide-item').first()).toBeVisible();
    await expect(page.locator('#relief-offline-banner')).toContainText('You are offline. This is a saved copy');

    for (const address of ['/pages/firstaid.html', '/pages/firstaid?from=home']) {
      await goOfflineAgain(context);
      await page.goto(address);
      await expect(page.locator('.guide-item').first()).toBeVisible();
    }
  });

  test('a page saved at install and never visited opens offline from its clean address', async ({ page, context }) => {
    await visitOnline(page);
    // pages/hospitals.html was fetched by the worker at install (through the .html address, which the server redirects) and not opened since.
    const hospitals = (await cacheEntries(page)).find((entry) => entry.path === '/pages/hospitals.html');
    expect(hospitals).toMatchObject({ status: 200 });
    await goOfflineAgain(context);
    await page.goto('/pages/hospitals');
    await expect(page).toHaveURL(/\/pages\/hospitals$/);
    await expect(page.getByRole('heading', { name: 'Find Hospitals Near You' })).toBeVisible();
  });

  test('a page that was never saved shows the offline page at the address that was asked for, with no redirect', async ({ page, context }) => {
    await visitOnline(page);
    for (const address of ['/pages/dashboard', '/pages/dashboard.html', '/profiles/patient/patient', '/pages/nope']) {
      await goOfflineAgain(context);
      const response = await page.goto(address);
      await expect(page).toHaveURL(new RegExp(address.replace(/[.]/g, '\\.') + '$'));
      expect(response.request().redirectedFrom(), address).toBeNull();
      await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
      await expect(page.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112');
      // Its stylesheet and logo come from pages/ and assets/, not from the folder of the address.
      await expect(page.locator('.offline-wrap')).toHaveCSS('margin-left', /^(?!0px)/);
      expect(await page.locator('img[alt="Relief logo"]').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    // Its links go to the saved pages from any address.
    await goOfflineAgain(context);
    await page.goto('/profiles/patient/patient');
    await goOfflineAgain(context);
    await page.getByRole('link', { name: 'First aid guides' }).click();
    await expect(page).toHaveURL(/\/pages\/firstaid\.html$/);
    await expect(page.locator('.guide-item').first()).toBeVisible();
  });

  test('online, an unknown route still shows the 404 answer of the server and is not replaced or saved', async ({ page }) => {
    await visitOnline(page);
    const before = (await cacheEntries(page)).map((entry) => entry.path);
    const response = await page.goto('/pages/nope');
    expect(response.status()).toBe(404);
    await expect(page.locator('body')).toContainText('Not found');
    const api = await page.evaluate(() => fetch('/api/firstaid').then((r) => r.status));
    expect(api).toBe(404);
    expect((await cacheEntries(page)).map((entry) => entry.path)).toEqual(before);
  });
});
