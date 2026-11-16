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

  test('the page says what reminders are not (no medical advice)', async ({ page }) => {
    await expect(page.locator('#reminder-disclaimer')).toContainText('does not suggest medicines, doses or schedules');
  });
});

// Notification permission is simulated with a stand-in for window.Notification that is added before the page
// loads. Real browser prompts and real operating system notifications are not exercised here.
async function stubNotification(page, { permission, answer = 'granted', constructorThrows = false, prefs } = {}) {
  await page.addInitScript(({ permission, answer, constructorThrows, prefs }) => {
    window.__notif = { asked: 0, shown: [] };
    if (permission === 'unsupported') {
      Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
    } else {
      function FakeNotification(title, init) {
        if (constructorThrows) throw new TypeError('Illegal constructor');
        window.__notif.shown.push({ title, body: init && init.body });
      }
      FakeNotification.permission = permission;
      FakeNotification.requestPermission = function () {
        window.__notif.asked += 1;
        FakeNotification.permission = answer;
        return Promise.resolve(answer);
      };
      Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: FakeNotification });
    }
    if (prefs) localStorage.setItem('relief_notification_prefs_v1', JSON.stringify(prefs));
  }, { permission, answer, constructorThrows, prefs });
}

test.describe('notification permission status', () => {
  const STATES = [
    { permission: 'unsupported', label: 'Not supported by this browser', relief: 'off', button: null },
    { permission: 'default', label: 'Not granted', relief: 'off', button: 'Turn on browser notifications' },
    { permission: 'denied', label: 'Denied', relief: 'off', button: null },
    { permission: 'granted', prefs: { browser: true }, label: 'Allowed', relief: 'on', button: null }
  ];

  for (const state of STATES) {
    test(`${state.permission}: the dashboard says so, never asks on load and does not promise delivery`, async ({ page }) => {
      await stubNotification(page, { permission: state.permission, prefs: state.prefs });
      await page.goto('/pages/dashboard.html');

      await expect(page.locator('#notify-permission')).toHaveText(`Browser permission: ${state.label}. Browser notifications from RELIEF: ${state.relief}.`);
      const delivery = page.locator('#notify-delivery');
      await expect(delivery).toContainText('open in a browser tab');
      await expect(delivery).toContainText('Do not rely on RELIEF as your only reminder');
      await expect(delivery).not.toContainText(/guarantee|never miss/i);
      if (state.button) await expect(page.locator('#notify-enable')).toBeVisible();
      else await expect(page.locator('#notify-enable')).toBeHidden();

      expect(await page.evaluate(() => (window.__notif ? window.__notif.asked : 0))).toBe(0);
      // Reminders can still be added whatever the permission is.
      await addReminder(page, { medicine: 'Vitamin C', time: '09:00' });
      await expect(item(page, 'Vitamin C')).toContainText('Active');
    });
  }

  test('permission is asked only after the button is pressed, and the answer is shown', async ({ page }) => {
    await stubNotification(page, { permission: 'default', answer: 'denied' });
    await page.goto('/pages/dashboard.html');
    expect(await page.evaluate(() => window.__notif.asked)).toBe(0);
    await page.getByRole('button', { name: 'Turn on browser notifications' }).click();
    await expect(page.locator('#notify-permission')).toContainText('Denied');
    expect(await page.evaluate(() => window.__notif.asked)).toBe(1);
    expect(await storedJson(page, 'relief_notification_prefs_v1')).toMatchObject({ browser: false });
  });

  test('a permission changed in the browser settings shows up when the page gets focus back', async ({ page }) => {
    await stubNotification(page, { permission: 'granted', prefs: { browser: true } });
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#notify-permission')).toContainText('Allowed');
    await page.evaluate(() => { window.Notification.permission = 'denied'; window.dispatchEvent(new Event('focus')); });
    await expect(page.locator('#notify-permission')).toHaveText('Browser permission: Denied. Browser notifications from RELIEF: off.');
  });

  test('a due reminder reaches the page banner and one notification when the permission allows it', async ({ page }) => {
    await stubNotification(page, { permission: 'granted', prefs: { browser: true } });
    await page.clock.install({ time: new Date('2026-10-24T08:00:30+05:30') });
    await page.goto('/pages/dashboard.html');
    await addReminder(page, { medicine: 'Thyroxine', time: '08:00' });
    await expect(page.locator('#reminder-banner')).toContainText('Thyroxine');
    const shown = await page.evaluate(() => window.__notif.shown);
    expect(shown).toHaveLength(1);
    expect(shown[0].body).not.toContain('Thyroxine');
  });

  test('when the browser refuses to create the notification the banner says it is only on the page', async ({ page }) => {
    await stubNotification(page, { permission: 'granted', constructorThrows: true, prefs: { browser: true } });
    await page.clock.install({ time: new Date('2026-10-24T08:00:30+05:30') });
    await page.goto('/pages/dashboard.html');
    await addReminder(page, { medicine: 'Thyroxine', time: '08:00' });
    await expect(page.locator('#reminder-banner')).toContainText('Thyroxine');
    await expect(page.locator('#reminder-banner')).toContainText('could not show a notification for this reminder');
  });
});
