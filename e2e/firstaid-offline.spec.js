// Journey: first aid guidance, including after the network is gone (service worker copy).
const { test, expect } = require('./fixtures');

test.describe('first aid', () => {
  test('lists guides, filters by search and by category', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    const guides = page.locator('.guide-item');
    await expect(guides.first()).toBeVisible();
    const all = await guides.count();
    expect(all).toBeGreaterThan(3);

    await page.getByLabel('Search first aid guides').fill('burn');
    await expect(guides).not.toHaveCount(all);
    await expect(guides.first()).toContainText(/burn/i);

    await page.getByLabel('Search first aid guides').fill('');
    await page.locator('.category-card[data-category="cpr"]').click();
    await expect(guides).toHaveCount(1);
    await expect(guides.first()).toContainText('CPR');
  });

  test('a guide opens to show its steps', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    await page.locator('.category-card[data-category="choking"]').click();
    const guide = page.locator('.guide-item').first();
    await guide.locator('.guide-header').click();
    await expect(guide).toHaveClass(/active/);
    await expect(guide.locator('.guide-steps li').first()).toBeVisible();
  });
});

test.describe('offline first aid', () => {
  test('after one online visit, the first aid page still opens offline with a "saved copy" banner', async ({ page, context }) => {
    // Visit online until the service worker controls the page (it caches the page and its scripts).
    await page.goto('/pages/firstaid.html');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const names = await caches.keys();
      if (!names.length) return 0;
      return (await (await caches.open(names[0])).keys()).length;
    })).toBeGreaterThan(3);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('.guide-item').first()).toBeVisible();
    await page.locator('.category-card[data-category="cpr"]').click();
    await expect(page.locator('.guide-item')).toHaveCount(1);
    await expect(page.locator('#relief-offline-banner')).toContainText('You are offline. This is a saved copy');
    await expect(page.locator('#relief-offline-banner')).toContainText('call your local emergency number');
  });

  test('pages that hold account data are not available offline', async ({ page, context }) => {
    await page.goto('/pages/firstaid.html');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = [];
      for (const n of names) (await (await caches.open(n)).keys()).forEach((r) => urls.push(new URL(r.url).pathname));
      return urls;
    });
    expect(cached).toContain('/pages/firstaid.html');
    expect(cached.some((p) => /dashboard|login|signup/.test(p))).toBe(false);
    // Not saved, so offline it shows the offline page instead of any account content.
    await page.goto('/pages/dashboard.html');
    await expect(page).toHaveURL(/\/pages\/offline\.html$/);
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
  });
});
