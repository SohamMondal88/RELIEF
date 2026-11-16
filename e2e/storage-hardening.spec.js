// Journey: the browser blocks storage, storage is full, or saved data is damaged (issue #168).
// An uncaught page error fails every test here (see fixtures.js), so "the page loads" also means
// "nothing threw while it loaded".
const { test, expect } = require('./fixtures');

const REMINDERS = 'relief_reminders_v1';
const HISTORY = 'relief_history_v1';
const BACKUP = '.unreadable';

// What Chrome and Safari do when site data is blocked: merely reading window.localStorage throws.
async function blockStorage(page) {
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny });
  });
}

// Saved data written before the page scripts run. The schema marker is set so the one-time
// migration of older data (storage-schema.js) does not run first: this is damage that happens later.
async function seed(page, values) {
  await page.addInitScript((entries) => {
    localStorage.setItem('relief_schema_version', '1');
    Object.keys(entries).forEach((key) => localStorage.setItem(key, entries[key]));
  }, values);
}

async function addReminder(page, medicine, time) {
  await page.getByLabel('Medicine or label').fill(medicine);
  await page.getByLabel('Time (every day)').fill(time);
  await page.getByRole('button', { name: 'Save Reminder' }).click();
}

const notice = (page) => page.locator('#storage-notice');
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

test.describe('storage blocked by the browser', () => {
  test('the dashboard still loads, works for this visit and says nothing can be saved', async ({ page }) => {
    await blockStorage(page);
    await page.goto('/pages/dashboard.html');

    await expect(page.locator('#reminder-form')).toBeVisible();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText('blocking storage');

    await addReminder(page, 'Vitamin D', '08:00');
    await expect(page.locator('.reminder-item', { hasText: 'Vitamin D' })).toBeVisible();
    await expect(notice(page)).toContainText('can not be saved');
  });

  test('the doctors page loads and Book Appointment still goes on to the appointments page', async ({ page }) => {
    await blockStorage(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/pages/doctors.html');
    await expect(page.locator('.doctor-card')).toHaveCount(6);

    await page.locator('.btn-book').first().click();
    await expect(page).toHaveURL(/appointments\.html$/);
    await expect(page.locator('#patient-form')).toBeAttached();
  });

  test('the appointments page loads', async ({ page }) => {
    await blockStorage(page);
    await page.goto('/pages/appointments.html');
    await expect(page.locator('#patient-form')).toBeAttached();
    await expect(page.locator('#my-requests-list')).toContainText('You have not sent any appointment requests');
  });

  test('the home page and the hospitals page load', async ({ page }) => {
    await blockStorage(page);
    await page.goto('/index.html');
    await expect(page.locator('body')).toBeVisible();
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospitals-list')).toBeAttached();
  });
});

test.describe('storage full', () => {
  test('a write that hits the quota is reported and the reminder stays on the page', async ({ page }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).indexOf('relief_reminders') === 0 || String(key).indexOf('relief_history') === 0) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    });
    await page.goto('/pages/dashboard.html');
    await expect(notice(page)).toContainText('could not be saved');

    await addReminder(page, 'Iron', '07:00');
    await expect(page.locator('.reminder-item', { hasText: 'Iron' })).toBeVisible();
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText('could not be saved');
  });
});

test.describe('damaged saved data', () => {
  const DAMAGED = [
    ['text that is not JSON', '{"medicine": "Vitamin D", "time":'],
    ['an object where a list belongs', '{"medicine":"Vitamin D","time":"08:00"}'],
    ['a number', '42'],
    ['a string', '"hello"']
  ];

  for (const [label, raw] of DAMAGED) {
    test('reminders stored as ' + label + ': the page loads, says so and keeps the original text', async ({ page }) => {
      await seed(page, { [REMINDERS]: raw });
      await page.goto('/pages/dashboard.html');

      await expect(page.locator('#reminder-form')).toBeVisible();
      await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
      await expect(notice(page)).toContainText('Saved reminders could not be read');
      await expect(notice(page)).toContainText('not deleted');
      // The page saves its (empty) state when it loads, which replaces the damaged value in the
      // main key. The original text is already in the copy by then.
      expect(await stored(page, REMINDERS + BACKUP)).toBe(raw);

      // Saving a new reminder works, and the copy stays as it was.
      await addReminder(page, 'Iron', '07:00');
      await expect(page.locator('.reminder-item', { hasText: 'Iron' })).toBeVisible();
      expect(JSON.parse(await stored(page, REMINDERS))).toHaveLength(1);
      expect(await stored(page, REMINDERS + BACKUP)).toBe(raw);
    });
  }

  test('a timeline that is not a list shows the notice and keeps the original text', async ({ page }) => {
    await seed(page, { [HISTORY]: '{"oops":true}' });
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#reminder-form')).toBeVisible();
    await expect(notice(page)).toContainText('Saved timeline could not be read');
    expect(await stored(page, HISTORY + BACKUP)).toBe('{"oops":true}');
  });

  test('a list with some unusable entries keeps the good ones, counts the rest and keeps the original', async ({ page }) => {
    const good = { id: 'r1', medicine: 'Metformin', time: '21:30', scheduleMode: 'local', status: 'active', createdAt: 1 };
    const raw = JSON.stringify([good, 'junk', 7, { medicine: '', time: 'late' }]);
    await seed(page, { [REMINDERS]: raw });
    await page.goto('/pages/dashboard.html');

    await expect(page.locator('.reminder-item')).toHaveCount(1);
    await expect(page.locator('.reminder-item')).toContainText('Metformin');
    await expect(notice(page)).toContainText('3 saved reminders could not be read');
    expect(await stored(page, REMINDERS + BACKUP)).toBe(raw);
  });

  test('healthy saved data shows no notice and no copy is made', async ({ page }) => {
    const good = { id: 'r1', medicine: 'Metformin', time: '21:30', scheduleMode: 'local', status: 'active', createdAt: 1 };
    await seed(page, { [REMINDERS]: JSON.stringify([good]) });
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('.reminder-item')).toContainText('Metformin');
    await expect(notice(page)).toBeHidden();
    expect(await stored(page, REMINDERS + BACKUP)).toBeNull();
  });

  test('damaged appointment requests and a damaged picked doctor do not stop the appointments page', async ({ page }) => {
    await seed(page, { relief_appointment_requests: '{not json', selectedDoctor: '[1,2,3]' });
    await page.goto('/pages/appointments.html');
    await expect(page.locator('#patient-form')).toBeAttached();
    await expect(page.locator('#my-requests-list')).toContainText('You have not sent any appointment requests');
  });

  test('damaged saved sessions (an object, or a list of non-objects) do not stop pages from loading', async ({ page }) => {
    await seed(page, { relief_auth_sessions: '{"token":1}' });
    await page.goto('/index.html');
    await expect(page.locator('body')).toBeVisible();

    await seed(page, { relief_auth_sessions: '[null, 5, "x", [1]]' });
    await page.goto('/pages/doctors.html');
    await expect(page.locator('.doctor-card')).toHaveCount(6);
  });
});
