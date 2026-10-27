// Journey: install metadata and the offline page (issue #94). Cache cleanup on update is covered in tests/pwa.test.js.
// See docs/OFFLINE_AND_INSTALL.md for the manual version of these checks.
const { test, expect } = require('./fixtures');

// Known bugs on main, fixed separately: session-guard.js throws "Illegal invocation" on every page, and
// api.js stops at "deleteAccount is not defined" on the pages that load it. None of these checks depend on them.
// (Two entries need the [value, options] form, a plain two item array is read as that pair.)
test.use({ allowedPageErrors: [[/Illegal invocation/, /deleteAccount is not defined/, /ReliefAPI is not defined/], { option: true }] });

async function waitForWorker(page, path) {
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const cachedPaths = (page) => page.evaluate(async () => {
  const out = [];
  for (const name of await caches.keys()) (await (await caches.open(name)).keys()).forEach((r) => out.push(new URL(r.url).pathname));
  return out.sort();
});

test.describe('install metadata', () => {
  test('the browser reads the manifest and finds nothing wrong with it', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    const cdp = await page.context().newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.url).toMatch(/\/manifest\.webmanifest$/);
    expect(manifest.errors).toEqual([]);
    expect(JSON.parse(manifest.data).short_name).toBe('RELIEF');
    await expect.poll(async () => {
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      // "in-incognito" only shows because tests run in a throwaway browser profile.
      return installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito');
    }).toEqual([]);
  });
});

test.describe('offline', () => {
  test('a page that was never saved shows the offline page, with emergency numbers and the saved guides', async ({ page, context }) => {
    await waitForWorker(page, '/pages/firstaid.html');
    await context.setOffline(true);
    await page.goto('/pages/symptoms.html');
    await expect(page).toHaveURL(/\/pages\/offline\.html$/);
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
    await expect(page.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112');
    await page.getByRole('link', { name: 'First aid guides' }).click();
    await expect(page.locator('.guide-item').first()).toBeVisible();
    await expect(page.locator('#relief-offline-banner')).toContainText('saved copy');
  });

  test('the home page, the dashboard and the login page are not saved and fall back to the offline page', async ({ page, context }) => {
    await waitForWorker(page, '/pages/firstaid.html');
    await page.goto('/index.html');
    await page.goto('/pages/dashboard.html');
    await page.goto('/pages/login.html');
    await page.goto('/pages/firstaid.html');
    const saved = await cachedPaths(page);
    expect(saved.some((p) => /dashboard|login|signup|index\.html|facilities\.json/.test(p))).toBe(false);
    expect(saved).toContain('/pages/offline.html');
    await context.setOffline(true);
    for (const target of ['/index.html', '/pages/dashboard.html', '/pages/login.html']) {
      await page.goto(target);
      await expect(page).toHaveURL(/\/pages\/offline\.html$/);
    }
  });
});
