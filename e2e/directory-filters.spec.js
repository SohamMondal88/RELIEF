const { test, expect } = require('./fixtures');

test('sorting doctors preserves the active intersection and clearing returns the full list', async ({ page }) => {
  await page.goto('/pages/doctors.html');
  const cards = page.locator('.doctor-card');
  await expect(cards.first()).toBeVisible();
  const total = await cards.count();
  const input = page.getByRole('textbox', { name: /Search by specialty/ });
  await page.getByLabel('Specialty', { exact: true }).selectOption('cardiologist');
  await input.fill('cardiologist');
  await expect(cards).toHaveCount(1);
  await page.getByLabel('Sort doctors by').selectOption('rating');
  await expect(cards).toHaveCount(1);
  await input.fill('not a matching doctor');
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(total);
  await expect(input).toHaveValue('');
  await expect(page.getByLabel('Sort doctors by')).toHaveValue('rating');
});

test('clearing hospital filters restores the full list without changing sort', async ({ page }) => {
  await page.goto('/pages/hospitals.html');
  const cards = page.locator('.hospital-card');
  await expect(cards.first()).toBeVisible();
  const total = await cards.count();
  await page.getByLabel('Area', { exact: true }).selectOption('Kolkata');
  expect(await cards.count()).toBeLessThan(total);
  await page.getByLabel('Verified only').check();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByLabel('Verified only')).not.toBeChecked();
  await expect(page.getByLabel('Area', { exact: true })).toHaveValue('');
  await expect(cards).toHaveCount(total);
});
