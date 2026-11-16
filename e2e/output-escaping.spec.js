// Journey: text that comes from a server or a data file is shown as text (issue #169).
// The SOS dialog is fed a hostile server message; the directory and first aid pages are checked
// to still draw their cards now that they build them with the shared escape helper.
const { test, expect } = require('./fixtures');

const HOSTILE = '<img src=x onerror="window.__pwned=1">';

test('SOS dialog shows a hostile server message as text and runs nothing', async ({ page }) => {
  await page.addInitScript(() => { window.RELIEF_SOS_ENDPOINT = '/api/sos'; });
  await page.route('**/api/sos', (route) => route.fulfill({ json: { delivered: false, message: '<img src=x onerror="window.__pwned=1">' } }));
  await page.goto('/pages/ambulances.html');
  await page.locator('#relief-emergency-sos-trigger').click();
  const dialog = page.getByRole('dialog', { name: 'Emergency SOS' });
  await dialog.getByRole('button', { name: 'Confirm Emergency SOS Request' }).click();

  await expect(dialog.getByRole('alert')).toContainText(HOSTILE);
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await expect(dialog.locator('a[href="tel:112"]').first()).toBeVisible();
});

test('doctors page still draws its cards, each with its photo', async ({ page }) => {
  await page.goto('/pages/doctors.html');
  const cards = page.locator('.doctor-card');
  await expect(cards).toHaveCount(6);
  const sarah = cards.filter({ hasText: 'Dr. Sarah Johnson' });
  await expect(sarah.locator('.doctor-image')).toHaveCSS('background-image', /doctor1\.jpg/);
  await expect(sarah.locator('.btn-book')).toHaveAttribute('data-id', '1');
});

// With the map library blocked, pharmacies.js throws "L is not defined" after the list is drawn.
// That is the same bug as on main (the ambulances page had it too) and is not what this file tests.
test.describe('pharmacies', () => {
  test.use({ allowedPageErrors: [/^L is not defined$/] });

  test('pharmacies page still draws its cards, with the phone number on the Call button', async ({ page }) => {
    await page.goto('/pages/pharmacies.html');
    const cards = page.locator('.pharmacy-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().locator('.pharmacy-image')).toHaveCSS('background-image', /\.(jpg|png|jpeg|webp)/);
    await expect(cards.first().locator('.btn-call')).toHaveAttribute('data-phone', /\+1 555/);
  });
});

test('ambulances page still lists its services with a Call button', async ({ page }) => {
  await page.goto('/pages/ambulances.html');
  const items = page.locator('.ambulance-item');
  await expect(items).toHaveCount(4);
  await expect(items.first().locator('.btn-call')).toHaveAttribute('data-phone', '+1 555 911 0000');
});

test('first aid page still opens a guide with its formatted steps', async ({ page }) => {
  await page.goto('/pages/firstaid.html');
  const first = page.locator('.guide-item').first();
  await first.locator('.guide-header').click();
  await expect(first.locator('.guide-content ol.guide-steps li').first()).toBeVisible();
  await expect(first.locator('.guide-content .guide-warning')).toBeVisible();
});
