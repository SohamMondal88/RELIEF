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

  test('the timeline is dated with the local day, also between midnight and 05:30 in India', async ({ page }) => {
    // 02:00 on 24 Oct in Asia/Kolkata (the project's test zone) is still 23 Oct in UTC.
    await page.clock.install({ time: new Date('2026-10-24T02:00:00+05:30') });
    await page.reload();
    await addReminder(page, { medicine: 'Vitamin D', time: '08:00' });

    const firstRow = page.locator('#timeline tr').first();
    await expect(firstRow).toContainText('Medication reminder created');
    await expect(firstRow.locator('td').first()).toHaveText('2026-10-24');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('relief_history_v1'))[0].date);
    expect(saved).toBe('2026-10-24');
  });

  test('the timeline follows a device time zone change made while the tab stays open', async ({ page }) => {
    // 02:00 on 24 Oct in Asia/Kolkata is 23 Oct in Los Angeles.
    await page.clock.install({ time: new Date('2026-10-24T02:00:00+05:30') });
    await page.reload();
    await addReminder(page, { medicine: 'Vitamin D', time: '08:00' });
    await expect(page.locator('#timeline tr').first().locator('td').first()).toHaveText('2026-10-24');

    // The device moves to Los Angeles without a reload: anything asking Intl for the device zone
    // (no explicit timeZone option) is told Los Angeles from now on.
    await page.evaluate(() => {
      const make = (target, args, newTarget) => {
        const formatter = Reflect.construct(target, args, newTarget || target);
        if (!(args[1] && args[1].timeZone)) {
          const resolved = formatter.resolvedOptions.bind(formatter);
          formatter.resolvedOptions = () => Object.assign({}, resolved(), { timeZone: 'America/Los_Angeles' });
        }
        return formatter;
      };
      Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
        construct: (target, args, newTarget) => make(target, args, newTarget),
        apply: (target, thisArg, args) => make(target, args)
      });
    });
    await addReminder(page, { medicine: 'Iron', time: '20:00' });
    await expect(page.locator('#timeline tr').first()).toContainText('Iron at 20:00');
    await expect(page.locator('#timeline tr').first().locator('td').first()).toHaveText('2026-10-23');
  });

  test('the page says what reminders are not (no medical advice)', async ({ page }) => {
    await expect(page.locator('#reminder-disclaimer')).toContainText('does not suggest medicines, doses or schedules');
  });
});
