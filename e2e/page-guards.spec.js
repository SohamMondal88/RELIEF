// Shared page scripts must not crash on a page that lacks an element they look for (Issue #193).
// The page fixture in fixtures.js already fails a test on any uncaught error, so these only need to use the page.
const { test, expect } = require('./fixtures');

test.describe('page scripts guard their elements', () => {
  test('blog: the scripts after the old mobile menu code still run', async ({ page }) => {
    await page.goto('/pages/blog.html');
    const navbar = page.locator('.navbar');
    await expect(navbar).not.toHaveClass(/scrolled/);
    await page.evaluate(() => { document.body.style.minHeight = '4000px'; window.scrollTo(0, 400); });
    await expect(navbar).toHaveClass(/scrolled/);
    // animateOnScroll runs once on load, so the cards are marked for their entrance animation
    await expect(page.locator('.article-card.animate').first()).toBeAttached();
  });

  test('first aid: clicking outside the guides after a search with no result does not throw', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    await page.getByLabel('Search first aid guides').fill('zzzz no such guide');
    await expect(page.locator('.guide-item')).toHaveCount(1);
    await expect(page.locator('.guide-item')).toContainText('No guides found');
    await page.locator('h1').first().click();
    await page.getByLabel('Search first aid guides').fill('');
    await expect(page.locator('.guide-item').first()).toBeVisible();
  });
});
