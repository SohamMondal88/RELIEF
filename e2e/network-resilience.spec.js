// Journey: the site on a bad connection. Offline, slow and failing requests, and outside hosts (fonts,
// icon font, Leaflet, map tiles, geocoding) that fail in different ways. Nothing here talks to a real service:
// the helpers in helpers.js only abort, fake or hold requests, and fixtures.js blocks everything else.
const { test, expect } = require('./fixtures');
const {
  failRequests, errorResponse, holdRequests, failThirdParty, goOffline, goOnline, waitForOfflineCopy, storedJson
} = require('./helpers');

const FACILITIES_JSON = '**/assets/data/facilities.json';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search*';
const mainNav = (page) => page.getByRole('navigation', { name: 'Main navigation' });

test.describe('outside hosts that fail', () => {
  // [path, heading, something that must still work on that page]
  const PAGES = [
    ['/pages/firstaid.html', 'First Aid Guide', async (page) => {
      await expect(page.locator('.guide-item').first()).toBeVisible();
      await page.getByLabel('Search first aid guides').fill('burn');
      await expect(page.locator('.guide-item').first()).toContainText(/burn/i);
    }],
    ['/pages/hospitals.html', 'Find Hospitals Near You', async (page) => {
      await expect(page.locator('.hospital-card').first()).toBeVisible();
      await expect(page.locator('.loading-state')).toHaveCount(0);
    }],
    ['/pages/symptoms.html', 'Symptom Information & Guidance', async (page) => {
      await page.locator('input[name="emergency_sign"][value="chest_pain"]').check();
      await expect(page.locator('#immediate-emergency-alert')).toBeVisible();
      await expect(page.locator('#immediate-emergency-alert a[href="tel:112"]')).toBeVisible();
    }],
    ['/pages/contact.html', "We're Here to Help", async (page) => {
      await expect(page.locator('form').first()).toBeVisible();
    }]
  ];

  for (const mode of ['abort', 'error', 'empty']) {
    for (const [path, heading, feature] of PAGES) {
      test(`${path}: text, navigation and the page's own feature work when outside hosts ${mode}`, async ({ page, baseURL }) => {
        const outside = await failThirdParty(page, { baseURL, mode });
        await page.goto(path);

        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        await expect(mainNav(page).getByRole('link', { name: 'Home' })).toBeVisible();
        await feature(page);
        // The failure really was exercised.
        expect(outside.requests.length, 'outside requests that were intercepted').toBeGreaterThan(0);
      });
    }
  }

  test('home page content still appears after the splash screen when outside hosts fail', async ({ page, baseURL }) => {
    const outside = await failThirdParty(page, { baseURL, mode: 'abort' });
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Your Health, Our Priority' })).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: 'About Us' })).toHaveAttribute('href', 'pages/about.html');
    expect(outside.requests.length).toBeGreaterThan(0);
  });
});

test.describe('connection lost while the page is open', () => {
  test('first aid keeps working, says it is offline, and the banner goes away when the connection is back', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    await expect(page.locator('.guide-item').first()).toBeVisible();
    const banner = page.locator('#relief-offline-banner');
    await expect(banner).toHaveCount(0);

    await goOffline(page);
    await expect(banner).toContainText('You are offline');
    await expect(banner).toContainText('call your local emergency number');

    await page.getByLabel('Search first aid guides').fill('burn');
    await expect(page.locator('.guide-item').first()).toContainText(/burn/i);
    await page.locator('.guide-item').first().locator('.guide-header').click();
    await expect(page.locator('.guide-item').first().locator('.guide-steps li').first()).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: 'Home' })).toHaveAttribute('href', /index\.html$/);

    await goOnline(page);
    await expect(banner).toHaveCount(0);
  });

  test('the symptom checker still raises the emergency alert with the call links', async ({ page }) => {
    await page.goto('/pages/symptoms.html');
    await goOffline(page);
    await page.locator('input[name="emergency_sign"][value="breathing_difficulty"]').check();
    const alert = page.locator('#immediate-emergency-alert');
    await expect(alert).toBeVisible();
    await expect(alert.locator('a[href="tel:112"]')).toBeVisible();
    await expect(alert.locator('a[href="tel:911"]')).toBeVisible();
  });
});

test.describe('offline after one online visit (service worker)', () => {
  // sw.js precaches hospitals.html but not every script it needs (facility-utils.js, location-service.js,
  // location-panel.js, i18n.js and others), so offline the page loads without its list and without a message.
  test.fixme('the hospitals page opens offline, says so, and its list ends in an error with Retry', async ({ page }) => {
    await waitForOfflineCopy(page, '/pages/hospitals.html');
    await goOffline(page);
    await page.reload();

    await expect(page.locator('#relief-offline-banner')).toContainText('You are offline');
    const error = page.locator('.error-state');
    await expect(error).toContainText('The facility list could not be loaded');
    await expect(page.locator('.loading-state')).toHaveCount(0);
    // Other parts of the page are unaffected: search box and navigation are still there.
    await expect(page.getByLabel('Search by name, area or service')).toBeEnabled();
    await expect(mainNav(page).getByRole('link', { name: 'Home' })).toBeVisible();

    await goOnline(page);
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.hospital-card').first()).toBeVisible();
    await expect(error).toHaveCount(0);
  });
});

test.describe('slow and failing requests for local data', () => {
  test('a slow facility list shows a loading state, the rest of the page stays usable, and the list replaces it', async ({ page }) => {
    const list = await holdRequests(page, FACILITIES_JSON);
    await page.goto('/pages/hospitals.html');

    await expect(page.locator('.loading-state')).toHaveText('Loading facilities...');
    await expect(page.locator('#directory-status')).toHaveText('Loading facilities...');
    await expect.poll(list.pending).toBe(1);
    // Unrelated parts keep working while the list is pending.
    await expect(page.getByRole('heading', { level: 1, name: 'Find Hospitals Near You' })).toBeVisible();
    await page.getByLabel('Search by name, area or service').fill('Bankura');
    await expect(mainNav(page).getByRole('link', { name: 'Home' })).toBeVisible();

    await list.release();
    await expect(page.locator('.hospital-card').first()).toBeVisible();
    await expect(page.locator('.loading-state')).toHaveCount(0);
  });

  test('a failing facility list ends the loading state with an error, and the language switcher still works', async ({ page }) => {
    const list = await errorResponse(page, FACILITIES_JSON, { status: 503 });
    await page.goto('/pages/hospitals.html');

    await expect(page.locator('.error-state')).toContainText('The facility list could not be loaded');
    await expect(page.locator('.loading-state')).toHaveCount(0);
    expect(list.requests.length).toBe(1);

    await page.locator('#relief-lang').selectOption('bn');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.locator('.error-state')).toBeVisible();
  });

  test('if the Bengali translation file cannot load, the page stays in English with no error', async ({ page }) => {
    const locale = await failRequests(page, '**/assets/locales/bn.json');
    await page.goto('/pages/firstaid.html');
    await page.locator('#relief-lang').selectOption('bn');

    await expect.poll(() => locale.requests.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { level: 1, name: 'First Aid Guide' })).toBeVisible();
    await expect(page.locator('.guide-item').first()).toBeVisible();
  });

  test('a slow Bengali translation file switches the text once it arrives', async ({ page }) => {
    const locale = await holdRequests(page, '**/assets/locales/bn.json');
    await page.goto('/pages/firstaid.html');
    await page.locator('#relief-lang').selectOption('bn');

    await expect.poll(locale.pending).toBe(1);
    await expect(page.getByRole('heading', { level: 1, name: 'First Aid Guide' })).toBeVisible();
    await page.getByLabel('Search first aid guides').fill('burn');
    await expect(page.locator('.guide-item').first()).toContainText(/burn/i);

    await locale.release();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('প্রাথমিক চিকিৎসা নির্দেশিকা');
  });

  test('a place lookup that is slow shows a waiting message, and one that fails ends with an error message', async ({ page }) => {
    const lookup = await holdRequests(page, NOMINATIM);
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card').first()).toBeVisible();

    await page.getByLabel('Or enter a town, village, PIN code or address').fill('Mejia');
    await page.getByRole('button', { name: 'Set location' }).click();
    await expect(page.locator('#location-current')).toContainText('Looking up that place');
    await expect.poll(lookup.pending).toBe(1);
    // The facility list is not blocked by the pending lookup.
    await page.getByLabel('Search by name, area or service').fill('Bankura');
    await expect(page.locator('.hospital-card').first()).toContainText('Bankura');

    await lookup.fail();
    await expect(page.locator('#location-error')).not.toBeEmpty();
    await expect(page.locator('#location-current')).not.toContainText('Looking up that place');
    expect(await storedJson(page, 'userLocation')).toBeNull();
  });
});

// Requests that never get any answer at all. These describe the wanted behaviour and stay skipped (and are
// listed under "Known gaps" in docs/E2E_TESTING.md) until the page is fixed.
test.describe('requests that never finish', () => {
  // A stylesheet in <head> that never answers (Font Awesome here) stops the parser: not even the <h1> is
  // in the page, so nothing, including the emergency number, can be read until the browser gives up.
  test.fixme('first aid is readable while an outside stylesheet is still pending', async ({ page, baseURL }) => {
    await failThirdParty(page, { baseURL, mode: 'hang' });
    await page.goto('/pages/firstaid.html', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { level: 1, name: 'First Aid Guide' })).toBeVisible();
    await expect(page.locator('.guide-item').first()).toBeVisible();
  });

  // fetch() has no timeout, so hospitals.js shows "Loading facilities..." for ever.
  test.fixme('the facility list gives up waiting and shows the error with Retry', async ({ page }) => {
    test.setTimeout(45000);
    await holdRequests(page, FACILITIES_JSON);
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.loading-state')).toBeVisible();
    await expect(page.locator('.error-state')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.loading-state')).toHaveCount(0);
  });

  // Same for the Nominatim lookup in location-service.js: "Looking up that place..." for ever.
  test.fixme('a place lookup gives up waiting and shows an error', async ({ page }) => {
    test.setTimeout(45000);
    await holdRequests(page, NOMINATIM);
    await page.goto('/pages/hospitals.html');
    await page.getByLabel('Or enter a town, village, PIN code or address').fill('Mejia');
    await page.getByRole('button', { name: 'Set location' }).click();
    await expect(page.locator('#location-error')).not.toBeEmpty({ timeout: 20000 });
    await expect(page.locator('#location-current')).not.toContainText('Looking up that place');
  });
});
