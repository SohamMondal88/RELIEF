// Journey: medicine reminders on the dashboard (add, validate, edit, pause, resume, done, remove, persist).
const { test, expect } = require('./fixtures');
const { storedJson } = require('./helpers');

const KEY = 'relief_reminders_v1';

async function addReminder(page, { medicine, time, instructions }) {
  await page.getByLabel('Medicine or label').fill(medicine);
  if (instructions) await page.getByLabel('Note for yourself (optional)').fill(instructions);
  await page.getByLabel('Time (every day)').fill(time);
  await page.getByRole('button', { name: 'Save Reminder' }).click();
}

const item = (page, medicine) => page.locator('.reminder-item', { hasText: medicine });

test.describe('medicine reminders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
  });

  test('add a reminder: it is listed, counted and saved in this browser', async ({ page }) => {
    await addReminder(page, { medicine: 'Vitamin D', time: '08:00', instructions: 'after breakfast' });

    const row = item(page, 'Vitamin D');
    await expect(row).toContainText('Active');
    await expect(row).toContainText('Daily at 08:00');
    await expect(row).toContainText('after breakfast');
    await expect(page.locator('#kpi-reminders')).toHaveText('1');
    await expect(page.locator('#reminder-form #medicine')).toHaveValue('');

    const saved = await storedJson(page, KEY);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ medicine: 'Vitamin D', time: '08:00', status: 'active' });

    // The timeline records it.
    await expect(page.locator('#timeline')).toContainText('Medication reminder created');
  });

  test('a saved reminder is still there after a reload', async ({ page }) => {
    await addReminder(page, { medicine: 'Metformin 500mg', time: '21:30' });
    await page.reload();
    await expect(item(page, 'Metformin 500mg')).toContainText('Daily at 21:30');
    await expect(page.locator('#kpi-reminders')).toHaveText('1');
  });

  test('validation: a missing name or time and a duplicate are refused with messages', async ({ page }) => {
    await page.getByRole('button', { name: 'Save Reminder' }).click();
    const errors = page.locator('#reminder-error-summary');
    await expect(errors).toBeVisible();
    await expect(errors).toHaveAttribute('role', 'alert');
    await expect(errors.locator('li').first()).not.toBeEmpty();
    expect(await storedJson(page, KEY)).toEqual([]);

    await addReminder(page, { medicine: 'Iron', time: '07:00' });
    await expect(errors).toBeHidden();
    await addReminder(page, { medicine: 'Iron', time: '07:00' });
    await expect(errors).toBeVisible();
    await expect(page.locator('.reminder-item')).toHaveCount(1);
  });

  test('edit changes the reminder instead of adding a second one', async ({ page }) => {
    await addReminder(page, { medicine: 'Aspirin', time: '09:00' });
    await item(page, 'Aspirin').getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('button', { name: 'Update Reminder' })).toBeVisible();
    await expect(page.getByLabel('Medicine or label')).toBeFocused();

    await page.getByLabel('Time (every day)').fill('10:15');
    await page.getByRole('button', { name: 'Update Reminder' }).click();

    await expect(page.locator('.reminder-item')).toHaveCount(1);
    await expect(item(page, 'Aspirin')).toContainText('Daily at 10:15');
    expect((await storedJson(page, KEY))[0].time).toBe('10:15');
  });

  test('pause stops it counting as active, resume brings it back', async ({ page }) => {
    await addReminder(page, { medicine: 'Calcium', time: '12:00' });
    const row = item(page, 'Calcium');

    await row.getByRole('button', { name: 'Pause' }).click();
    await expect(row).toContainText('Paused');
    await expect(page.locator('#kpi-reminders')).toHaveText('0');
    expect((await storedJson(page, KEY))[0].status).toBe('paused');

    await row.getByRole('button', { name: 'Resume' }).click();
    await expect(row).toContainText('Active');
    await expect(page.locator('#kpi-reminders')).toHaveText('1');
  });

  test('done, then remove, deletes it from the list and from storage', async ({ page }) => {
    await addReminder(page, { medicine: 'Zinc', time: '18:00' });
    const row = item(page, 'Zinc');

    await row.getByRole('button', { name: 'Done' }).click();
    await expect(row).toContainText('Completed');
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
    expect(await storedJson(page, KEY)).toEqual([]);
    await page.reload();
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
  });

  test('a reminder that is due shows in the page banner (no browser permission needed)', async ({ page }) => {
    // Fix the clock at 08:00:30 in Asia/Kolkata so "due now" is the same on every machine.
    await page.clock.install({ time: new Date('2026-10-24T08:00:30+05:30') });
    await page.reload();
    await addReminder(page, { medicine: 'Thyroxine', time: '08:00' });

    const banner = page.locator('#reminder-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('Thyroxine');
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
  });

  test('two dashboard tabs show one due reminder between them, not one each', async ({ page, context }) => {
    // The two tabs share one fake clock, so a single runFor() ticks both renderers at the same
    // instant and they can both check before the first tab's write reaches the other one. The
    // tabs therefore run on different 30 second phases and the clock moves in separate steps.
    await context.clock.install({ time: new Date('2026-10-24T07:59:00+05:30') });
    await page.reload();
    const other = await context.newPage();
    await other.goto('/pages/dashboard.html');
    await expect(other.locator('#reminder-list')).toContainText('No reminders yet.');

    // Start the first tab's timer 15 seconds after the other tab's.
    await context.clock.runFor(15000);
    await page.reload();
    await addReminder(page, { medicine: 'Thyroxine', time: '08:00' });
    await expect(page.locator('#reminder-banner')).toBeHidden();
    // The other tab picks the new reminder up from storage without a reload.
    await expect(item(other, 'Thyroxine')).toBeVisible();

    // 07:59:15 to 08:00:00: only the other tab's timer reaches the due time.
    await context.clock.runFor(45000);
    const bannersShown = async () => (await page.locator('#reminder-banner').isVisible() ? 1 : 0) + (await other.locator('#reminder-banner').isVisible() ? 1 : 0);
    await expect.poll(bannersShown).toBe(1);
    await expect.poll(async () => (await storedJson(page, KEY))[0].lastNotifiedOn).toBe('2026-10-24');

    // The first tab's next check (08:00:15) now reads the saved mark and must not add a second banner.
    await context.clock.runFor(30000);
    expect(await bannersShown()).toBe(1);
    await other.close();
  });

  test('data deleted in another tab is not written back by a tab that still shows it', async ({ page, context }) => {
    await addReminder(page, { medicine: 'Zinc', time: '18:00' });
    const other = await context.newPage();
    await other.goto('/pages/dashboard.html');
    await expect(item(other, 'Zinc')).toBeVisible();

    // The other tab deletes the data the way "Delete my account and data" does: the keys go away.
    await other.evaluate(() => {
      localStorage.removeItem('relief_reminders_v1');
      localStorage.removeItem('relief_history_v1');
    });

    // The first tab follows the deletion and leaves storage empty.
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
    await expect(page.locator('#timeline')).not.toContainText('Medication reminder created');
    const keys = await page.evaluate(() => [localStorage.getItem('relief_reminders_v1'), localStorage.getItem('relief_history_v1')]);
    expect(keys).toEqual([null, null]);
    await other.close();
  });

  test('the page says what reminders are not (no medical advice)', async ({ page }) => {
    await expect(page.locator('#reminder-disclaimer')).toContainText('does not suggest medicines, doses or schedules');
  });
});
