// Journey: "Clear data stored in this browser" on the dashboard (Issue #81).
const { test, expect } = require('./fixtures');

const seed = (page) => page.evaluate(() => {
  localStorage.setItem('relief_reminders_v1', JSON.stringify([{ id: 'r1', medicine: 'Vitamin D', time: '08:00', instructions: '', startDate: '', endDate: '', status: 'active', scheduleMode: 'local', timeZone: 'Asia/Kolkata', lastNotifiedOn: '', lastNotifiedAtMs: 0 }]));
  localStorage.setItem('userLocation', JSON.stringify({ lat: 22.57, lng: 88.36, source: 'manual', label: 'Kolkata' }));
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('some_other_app_state', 'keep me');
});

const keys = (page) => page.evaluate(() => Object.keys(localStorage).sort());

test.describe('clear data stored in this browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
    await seed(page);
    await page.reload();
    await expect(page.locator('.reminder-item')).toContainText('Vitamin D');
  });

  test('the confirmation lists exactly what is stored and says what is kept', async ({ page }) => {
    await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
    const box = page.locator('#privacy-clear-confirm');
    await expect(box).toBeVisible();
    await expect(page.locator('#privacy-clear-title')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Clear data stored in this browser' })).toHaveAttribute('aria-expanded', 'true');

    const listed = await page.locator('#privacy-clear-list li code').allTextContents();
    const stored = (await keys(page)).filter((k) => k.startsWith('relief_') || k === 'userLocation' || k === 'selectedDoctor');
    expect(listed.sort()).toEqual(stored.sort());
    expect(listed).toEqual(expect.arrayContaining(['relief_reminders_v1', 'userLocation']));
    await expect(box).toContainText('2 other items stored for this site by other apps will be kept');
    await expect(box).toContainText('does not contact any server and does not delete an account');
    // Nothing is removed by opening it.
    expect(await keys(page)).toEqual(expect.arrayContaining(['relief_reminders_v1', 'theme', 'some_other_app_state']));
  });

  test('cancel and Escape leave everything in place', async ({ page }) => {
    const before = await keys(page);
    await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.locator('#privacy-clear-confirm')).toBeHidden();
    await expect(page.locator('#privacy-status')).toContainText('Nothing was cleared');
    await expect(page.getByRole('button', { name: 'Clear data stored in this browser' })).toBeFocused();
    expect(await keys(page)).toEqual(before);

    await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#privacy-clear-confirm')).toBeHidden();
    expect(await keys(page)).toEqual(before);
  });

  test('confirming removes the RELIEF keys, keeps the others and does not claim anything about a server', async ({ page }) => {
    await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
    await page.getByRole('button', { name: 'Yes, clear this data' }).click();

    const status = page.locator('#privacy-status');
    await expect(status).toContainText('Data stored in this browser was cleared');
    await expect(status).toContainText('Medicine reminders');
    await expect(status).toContainText('RELIEF did not contact any server');
    await expect(status).not.toContainText(/account (was|were) deleted/i);
    await expect(status).toBeFocused();

    const left = await keys(page);
    expect(left).toEqual(expect.arrayContaining(['theme', 'some_other_app_state']));
    expect(left).not.toContain('relief_reminders_v1');
    expect(left).not.toContain('userLocation');

    // The dashboard did not write its old state back.
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
    await expect(page.locator('#kpi-reminders')).toHaveText('0');
    expect(await page.evaluate(() => localStorage.getItem('relief_reminders_v1') || '')).not.toContain('Vitamin D');
    await page.reload();
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
  });

  test('storage that refuses to remove a key is reported, and the rest is still removed', async ({ page }) => {
    // Simulated: removing userLocation does nothing (as if the browser blocked it).
    await page.evaluate(() => {
      const real = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (k) { if (k === 'userLocation') return; return real.call(this, k); };
    });
    await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
    await page.getByRole('button', { name: 'Yes, clear this data' }).click();
    const status = page.locator('#privacy-status');
    await expect(status).toContainText('Some data could not be cleared');
    await expect(status).toContainText('Could not remove: Saved location');
    await expect(status).toContainText('browser settings');
    expect(await keys(page)).toEqual(expect.arrayContaining(['userLocation', 'theme']));
  });

  test('the full account deletion is still its own control with its own confirmation', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete my account and data' }).click();
    await expect(page.locator('#privacy-confirm')).toBeVisible();
    await expect(page.locator('#privacy-clear-confirm')).toBeHidden();
    await page.getByRole('button', { name: 'Clear data stored in this browser' }).click();
    await expect(page.locator('#privacy-confirm')).toBeHidden();
    await expect(page.locator('#privacy-clear-confirm')).toBeVisible();
  });
});
