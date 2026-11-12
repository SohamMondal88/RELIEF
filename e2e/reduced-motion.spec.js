const { test, expect } = require('./fixtures');

test('reduced motion keeps home reveals readable and skips smooth anchor scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html');
  await expect(page.locator('.main-content')).toBeVisible();
  const cards = page.locator('.feature-card');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const card of await cards.all()) await expect(card).toHaveCSS('opacity', '1');
  // The skip link is left to the browser (it has to move focus, see accessibility.spec.js), so the scroll that main.js
  // starts itself is the back to top button, which appears once the page has been scrolled.
  await page.evaluate(() => window.scrollTo(0, 1500));
  const toTop = page.getByRole('button', { name: 'Back to top' });
  await expect(toTop).toBeVisible();
  await page.evaluate(() => { window.__scrolls = []; window.scrollTo = (options) => window.__scrolls.push(options); });
  await toTop.click();
  await expect.poll(() => page.evaluate(() => window.__scrolls.at(-1)?.behavior)).toBe('instant');
});

test('reduced motion shows About statistics immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/pages/about.html');
  for (const number of await page.locator('.stat-number[data-count]').all()) {
    await expect(number).toHaveText(new RegExp(`^${await number.getAttribute('data-count')}%?$`));
  }
});
