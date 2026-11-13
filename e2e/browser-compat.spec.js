// Browser compatibility smoke matrix (Issue #116). Every test here is tagged @compat: playwright.config.js runs only
// these on Firefox and WebKit, and Chromium runs them together with everything else.
// It covers navigation, a directory, a form, storage and emergency access, plus the same pages with the browser APIs that
// differ between engines taken away (geolocation, notifications, service worker), because those are the ones a real
// browser may not have. Nothing asks for a real permission: fixtures.js mocks geolocation as denied and blocks outside hosts.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const FACILITIES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8')).facilities;

// Remove an API the way a browser without it looks to a page: not in navigator / window at all.
// Call before page.goto.
async function withoutBrowserApis(page, apis) {
  await page.addInitScript((names) => {
    names.forEach((name) => {
      if (name === 'Notification') { try { delete window.Notification; } catch (e) { /* kept */ } }
      if (name === 'serviceWorker') { try { delete Navigator.prototype.serviceWorker; } catch (e) { /* kept */ } }
      if (name === 'geolocation') { try { delete Navigator.prototype.geolocation; } catch (e) { /* kept */ } try { delete navigator.geolocation; } catch (e) { /* kept */ } }
    });
  }, apis);
}

// What this browser really has, so a report shows why a test took the path it did.
async function detectFeatures(page) {
  return page.evaluate(() => ({
    localStorage: (() => { try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); return true; } catch (e) { return false; } })(),
    sessionStorage: (() => { try { sessionStorage.setItem('t', '1'); sessionStorage.removeItem('t'); return true; } catch (e) { return false; } })(),
    serviceWorker: 'serviceWorker' in navigator,
    notification: typeof window.Notification === 'function',
    geolocation: 'geolocation' in navigator && !!navigator.geolocation
  }));
}

test.describe('@compat navigation', () => {
  test('the main menu leads to About and Contact and the back button returns', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'About Us' }).click();
    await expect(page).toHaveURL(/pages\/about\.html$/);
    await nav.getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/pages\/contact\.html$/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/pages\/about\.html$/);
  });
});

test.describe('@compat directory', () => {
  test('hospitals lists every facility, search narrows it and an empty search says so', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const cards = page.locator('.hospital-card');
    await expect(cards).toHaveCount(FACILITIES.length);
    await expect(cards.first().locator('.verify-badge')).toHaveText('Not verified');

    await page.getByLabel('Search by name, area or service').fill('Bankura');
    const expected = FACILITIES.filter((f) => `${f.name} ${f.district} ${(f.services || []).join(' ')}`.toLowerCase().includes('bankura')).length;
    expect(expected).toBeGreaterThan(0);
    await expect(cards).toHaveCount(expected);

    await page.getByLabel('Search by name, area or service').fill('zzzz-not-a-hospital');
    await expect(cards).toHaveCount(0);
    await expect(page.locator('.no-results')).toContainText('No facilities found matching your criteria');
  });

  test('the directory works when the browser has no geolocation and the person enters a place instead', async ({ page }) => {
    await withoutBrowserApis(page, ['geolocation']);
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card')).toHaveCount(FACILITIES.length);
    await page.getByRole('button', { name: 'Use my current location' }).click();
    expect((await detectFeatures(page)).geolocation, 'the test could not remove geolocation in this browser').toBe(false);
    await expect(page.locator('#location-error')).toContainText('This browser does not support location');
    await expect(page.locator('.hospital-card')).toHaveCount(FACILITIES.length);
    await page.getByLabel('Or enter a town, village, PIN code or address').fill('Kolkata');
    await page.getByRole('button', { name: 'Set location' }).click();
    await expect(page.locator('#location-current')).toContainText('Using your chosen location');
  });
});

test.describe('@compat forms and storage', () => {
  test('a reminder form refuses an empty submit, saves a valid one and keeps it after a reload', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    const features = await detectFeatures(page);
    test.info().annotations.push({ type: 'features', description: JSON.stringify(features) });
    expect(features.localStorage, 'this browser blocks localStorage, so reminders cannot be saved').toBe(true);

    await page.getByRole('button', { name: 'Save Reminder' }).click();
    const errors = page.locator('#reminder-error-summary');
    await expect(errors).toBeVisible();
    await expect(errors).toHaveAttribute('role', 'alert');

    await page.getByLabel('Medicine or label').fill('Vitamin D');
    await page.getByLabel('Time (every day)').fill('08:00');
    await page.getByRole('button', { name: 'Save Reminder' }).click();
    await expect(errors).toBeHidden();
    const row = page.locator('.reminder-item', { hasText: 'Vitamin D' });
    await expect(row).toContainText('Daily at 08:00');

    await page.reload();
    await expect(page.locator('.reminder-item', { hasText: 'Vitamin D' })).toContainText('Daily at 08:00');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('relief_reminders_v1')).length)).toBe(1);
  });

  test('the dashboard says so when the browser has no notifications and still saves reminders', async ({ page }) => {
    await withoutBrowserApis(page, ['Notification']);
    await page.goto('/pages/dashboard.html');
    expect((await detectFeatures(page)).notification, 'the test could not remove Notification in this browser').toBe(false);
    await expect(page.locator('#notify-status')).toContainText('does not support notifications');
    await expect(page.locator('#notify-enable')).toBeHidden();
    await page.getByLabel('Medicine or label').fill('Iron');
    await page.getByLabel('Time (every day)').fill('07:00');
    await page.getByRole('button', { name: 'Save Reminder' }).click();
    await expect(page.locator('.reminder-item', { hasText: 'Iron' })).toBeVisible();
  });

  test('the contact form checks its fields before sending and keeps what was typed', async ({ page }) => {
    // The form guard treats a submit within 1.5 seconds of the page loading as a bot, so move the clock on.
    await page.clock.install();
    await page.goto('/pages/contact.html');
    await page.clock.fastForward(2500);
    await page.getByLabel('Full Name*').fill('Asha Rao');
    await page.getByLabel('Email Address*').fill('not-an-email');
    await page.getByLabel('Your Message*').fill('Hello');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByText('Message sent')).toHaveCount(0);
    await expect(page.getByLabel('Full Name*')).toHaveValue('Asha Rao');
    await expect(page.getByLabel('Your Message*')).toHaveValue('Hello');
  });
});

test.describe('@compat emergency access', () => {
  test('SOS opens and closes with no sign-in and no location permission', async ({ page }) => {
    await page.goto('/pages/ambulances.html');
    const trigger = page.locator('#relief-emergency-sos-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Emergency SOS' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel Emergency SOS' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Nothing was dialled or opened.
    expect((await relief(page)).opened).toEqual([]);
    expect((await relief(page)).links).toEqual([]);
  });

  test('the 112 call link is there and is a real tel: link', async ({ page }) => {
    await page.goto('/pages/ambulances.html');
    await expect(page.locator('a.relief-sos-quick-dial[href="tel:112"]')).toBeVisible();
  });

  test('emergency access still works in a browser with no geolocation, notifications or service worker', async ({ page, problems }) => {
    await withoutBrowserApis(page, ['geolocation', 'Notification', 'serviceWorker']);
    await page.goto('/index.html');
    const features = await detectFeatures(page);
    expect(features, 'the test could not remove these APIs in this browser').toMatchObject({ geolocation: false, notification: false, serviceWorker: false });
    for (const route of ['/index.html', '/pages/ambulances.html', '/pages/symptoms.html']) {
      await page.goto(route);
      await expect(page.locator('main, .main-content').first()).toBeVisible({ timeout: 8000 });
    }
    await page.goto('/pages/ambulances.html');
    await page.locator('#relief-emergency-sos-trigger').click();
    await expect(page.getByRole('dialog', { name: 'Emergency SOS' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel Emergency SOS' })).toBeFocused();
    expect(problems.pageErrors).toEqual([]);
  });
});
