const { test, expect } = require('./fixtures');

test('opens a shareable facility view and returns to the filtered directory', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/pages/hospitals.html');
  const search = page.getByRole('searchbox', { name: 'Search by name, area or service' });
  await search.fill('Bankura');
  const link = page.locator('.hospital-name a').first();
  await expect(link).toBeVisible();
  const name = await link.innerText();
  await link.focus();
  await page.keyboard.press('Enter');

  const panel = page.locator('#facility-detail');
  await expect(panel.getByRole('heading', { name, exact: true })).toBeFocused();
  await expect(panel).toContainText('Source:');
  await expect(panel).toContainText('Last checked:');
  const detailUrl = page.url();
  await panel.getByRole('link', { name: 'Back to facility search' }).click();
  await expect(search).toHaveValue('Bankura');
  await expect(link).toBeFocused();

  await page.goto(detailUrl);
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.goto('/pages/hospitals.html#facility=unlisted-record');
  await expect(panel).toContainText('This facility is not in the current directory.');
});
