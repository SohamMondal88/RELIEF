// Journey: find a facility. Search, filters, sorting by distance, manual-location fallback, save, directions.
// Geolocation is mocked (denied by default, see fixtures.js), geocoding is mocked, and window.open is replaced,
// so nothing reaches a real service.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { useGeolocation, storedJson, relief } = require('./helpers');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8'));
const FACILITIES = DATA.facilities;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search*';

const cards = (page) => page.locator('.hospital-card');
const status = (page) => page.locator('#directory-status');

test.describe('facility directory: search and filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(FACILITIES.length);
  });

  test('lists every facility from the data file and says how many were found', async ({ page }) => {
    await expect(status(page)).toHaveText(`${FACILITIES.length} facilities found.`);
    const first = cards(page).first();
    await expect(first.locator('.hospital-name')).not.toBeEmpty();
    await expect(first.locator('.verify-badge')).toHaveText('Not verified');
  });

  test('search narrows the list and an unknown term shows a clear empty state', async ({ page }) => {
    const search = page.getByLabel('Search by name, area or service');
    await search.fill('Bankura');
    const expected = FACILITIES.filter((f) => `${f.name} ${f.district} ${(f.services || []).join(' ')}`.toLowerCase().includes('bankura')).length;
    expect(expected).toBeGreaterThan(0);
    await expect(cards(page)).toHaveCount(expected);
    await expect(cards(page).first()).toContainText('Bankura');

    await search.fill('zzzz-not-a-hospital');
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('.no-results')).toContainText('No facilities found matching your criteria');
    await expect(status(page)).toHaveText('No facilities found.');

    await search.fill('');
    await expect(cards(page)).toHaveCount(FACILITIES.length);
  });

  test('area and service filters combine', async ({ page }) => {
    await page.locator('#location').selectOption('Kolkata');
    const kolkata = FACILITIES.filter((f) => f.district === 'Kolkata').length;
    await expect(cards(page)).toHaveCount(kolkata);
    for (const text of await page.locator('.hospital-location').allInnerTexts()) expect(text).toContain('Kolkata');

    const service = FACILITIES.find((f) => f.district === 'Kolkata' && (f.services || []).length).services[0];
    await page.locator('#services').selectOption(service);
    const both = FACILITIES.filter((f) => f.district === 'Kolkata' && (f.services || []).includes(service)).length;
    await expect(cards(page)).toHaveCount(both);
  });

  test('"Verified only" matches the data: none of the listed records is verified yet', async ({ page }) => {
    const verified = FACILITIES.filter((f) => f.verified === true).length;
    await page.getByLabel('Verified only').check();
    if (verified === 0) {
      await expect(cards(page)).toHaveCount(0);
      await expect(page.locator('.no-results')).toBeVisible();
    } else {
      await expect(cards(page)).toHaveCount(verified);
      await expect(page.locator('.verify-badge')).toHaveText(Array(verified).fill('Verified'));
    }
  });

  test('a card has a call link (not followed) and Directions opens a map link in a new tab', async ({ page }) => {
    const withPhone = cards(page).filter({ has: page.locator('a.btn-call') }).first();
    await expect(withPhone.locator('a.btn-call')).toHaveAttribute('href', /^tel:\+?\d+/);

    await cards(page).filter({ has: page.locator('.btn-directions') }).first().locator('.btn-directions').click();
    const { opened, links } = await relief(page);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    expect(links).toEqual([]);
  });

  test('saving a facility keeps it in "Saved Facilities" and after a reload', async ({ page }) => {
    const first = cards(page).first();
    const name = (await first.locator('.hospital-name').innerText()).trim();
    const save = first.locator('.btn-save');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#saved-facilities-list')).toContainText(name);
    expect(await storedJson(page, 'relief_saved_facilities')).toHaveLength(1);

    await page.reload();
    await expect(page.locator('#saved-facilities-list')).toContainText(name);
  });
});

test.describe('manual-location fallback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(FACILITIES.length);
    await expect(page.locator('#location-current')).toContainText('No location set');
  });

  test('"Use my location" with permission denied says so and keeps the A to Z list', async ({ page }) => {
    await page.locator('#use-my-location').click();
    await expect(status(page)).toContainText('Location permission was denied. Showing facilities sorted by name.');
    await expect(cards(page)).toHaveCount(FACILITIES.length);
    expect(await storedJson(page, 'userLocation')).toBeNull();
  });

  test('the panel explains a denied GPS request and offers the typed place instead', async ({ page }) => {
    await page.getByRole('button', { name: 'Use my current location' }).click();
    await expect(page.locator('#location-error')).toContainText('Location permission was denied');
    await expect(page.locator('#location-error')).toContainText('enter your town, village or PIN code');
    await expect(page.locator('#location-input')).toBeFocused();
  });

  test('a built-in town works with no network and sorting by distance puts nearby facilities first', async ({ page }) => {
    await page.getByLabel('Or enter a town, village, PIN code or address').fill('Kolkata');
    await page.getByRole('button', { name: 'Set location' }).click();
    await expect(page.locator('#location-current')).toContainText('Using your chosen location: Kolkata');

    const saved = await storedJson(page, 'userLocation');
    expect(saved).toMatchObject({ source: 'manual', label: 'Kolkata' });
    expect(saved.expiresAt - saved.savedAt).toBe(7 * 24 * 60 * 60 * 1000);

    await page.locator('#sort-by').selectOption('distance');
    await expect(cards(page).first().locator('.hospital-distance')).toBeVisible();
    const km = (await page.locator('.hospital-distance').allInnerTexts()).map((t) => parseFloat(t.replace(/[^\d.]/g, '')));
    expect(km.length).toBeGreaterThan(5);
    expect([...km]).toEqual([...km].sort((a, b) => a - b));
    await expect(cards(page).first().locator('.hospital-location')).toContainText('Kolkata');
  });

  test('a place that is not built in is looked up (mocked) and saved', async ({ page }) => {
    let requested = '';
    await page.route(NOMINATIM, (route) => {
      requested = route.request().url();
      return route.fulfill({ json: [{ lat: '23.4400', lon: '87.1200' }] });
    });
    await page.getByLabel('Or enter a town, village, PIN code or address').fill('Mejia');
    await page.getByRole('button', { name: 'Set location' }).click();
    await expect(page.locator('#location-current')).toContainText('Using your chosen location: Mejia');
    expect(requested).toContain('q=Mejia');
    expect(requested).toContain('countrycodes=in');
    expect(await storedJson(page, 'userLocation')).toMatchObject({ lat: 23.44, lng: 87.12, source: 'manual' });
  });

  test('an unknown place, a bad entry and a lookup failure each show their own message', async ({ page }) => {
    const input = page.getByLabel('Or enter a town, village, PIN code or address');
    const set = page.getByRole('button', { name: 'Set location' });
    const error = page.locator('#location-error');

    await page.route(NOMINATIM, (route) => route.fulfill({ json: [] }));
    await input.fill('Nowhereville');
    await set.click();
    await expect(error).toContainText('We could not find that place');

    await input.fill('12');
    await set.click();
    await expect(error).toContainText('Enter a town, village, address or a 6 digit PIN code');

    await page.unroute(NOMINATIM);
    await page.route(NOMINATIM, (route) => route.abort());
    await input.fill('Nowhereville');
    await set.click();
    await expect(error).toContainText('network is unavailable');
    expect(await storedJson(page, 'userLocation')).toBeNull();
  });
});

test.describe('device location (mocked)', () => {
  test('granted: the position is saved rounded, used for the list, and can be cleared', async ({ page }) => {
    await useGeolocation(page, { lat: 22.57263, lng: 88.36391 });
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(FACILITIES.length);

    await page.getByRole('button', { name: 'Use my current location' }).click();
    await expect(page.locator('#location-current')).toContainText('Using your detected location');
    expect(await storedJson(page, 'userLocation')).toMatchObject({ lat: 22.57, lng: 88.36, source: 'gps' });

    await page.getByRole('button', { name: 'Clear saved location' }).click();
    await expect(page.locator('#location-current')).toContainText('No location set');
    expect(await storedJson(page, 'userLocation')).toBeNull();
  });
});

test.describe('when the facility list cannot load', () => {
  test('shows an error with Try again, and it loads the list once the network is back', async ({ page }) => {
    await page.route('**/assets/data/facilities.json', (route) => route.abort());
    await page.goto('/pages/hospitals.html');
    const error = page.locator('.state-error');
    await expect(error).toHaveAttribute('role', 'alert', { timeout: 15000 });
    await expect(error).toContainText('Try again');
    await expect(error).toContainText('emergency number');
    await expect(cards(page)).toHaveCount(0);

    await page.unroute('**/assets/data/facilities.json');
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(cards(page)).toHaveCount(FACILITIES.length);
    await expect(error).toHaveCount(0);
  });

  test('a temporary server error is retried automatically and the list still loads', async ({ page }) => {
    let calls = 0;
    await page.route('**/assets/data/facilities.json', (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 503, body: 'down' });
      return route.continue();
    });
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(FACILITIES.length, { timeout: 15000 });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('a missing file (404) is not retried and says what happened', async ({ page }) => {
    let calls = 0;
    await page.route('**/assets/data/facilities.json', (route) => { calls += 1; return route.fulfill({ status: 404, body: 'no' }); });
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.state-error')).toBeVisible();
    expect(calls).toBe(1);
  });
});
