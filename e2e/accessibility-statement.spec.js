const { test, expect } = require('./fixtures');

test('accessibility statement provides honest limitations, feedback and keyboard navigation', async ({ page }) => {
  await page.goto('/pages/accessibility.html');
  await expect(page).toHaveTitle('Accessibility statement | RELIEF');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accessibility statement');
  await expect(page.getByRole('heading', { name: 'Known limitations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub issue tracker' })).toHaveAttribute('href', 'https://github.com/SohamMondal88/RELIEF/issues');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: 'Emergency resources' })).toBeVisible();
});
