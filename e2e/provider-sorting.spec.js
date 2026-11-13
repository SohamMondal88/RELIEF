// Journey: sorting the doctor, pharmacy and hospital lists (Issue #86). Only fields that are really in the data
// are offered (name, specialty, distance from a valid saved location, home delivery, listed opening hours),
// the order is the same every time, and the page says which order it used.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8'));
const status = (page) => page.locator('#directory-status');
const texts = (locator) => locator.allInnerTexts().then((list) => list.map((t) => t.trim()));

async function setPlace(page, place) {
  await page.getByLabel('Or enter a town, village, PIN code or address').fill(place);
  await page.getByRole('button', { name: 'Set location' }).click();
  await expect(page.locator('#location-current')).toContainText(`Using your chosen location: ${place}`);
}

test.describe('doctors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/doctors.html');
    await expect(page.locator('.doctor-card')).toHaveCount(6);
  });

  test('only name and specialty are offered, and no card shows a rating, review count, availability or distance', async ({ page }) => {
    await expect(page.getByLabel('Sort doctors by').locator('option')).toHaveText(['Name (A to Z)', 'Specialty (A to Z)']);
    await expect(page.locator('#availability')).toHaveCount(0);
    await expect(page.locator('.doctor-rating, .fa-star, .availability-badge')).toHaveCount(0);
    const text = await page.locator('.doctors-list').innerText();
    expect(text).not.toMatch(/review|available (today|tomorrow|this week|next week)|miles away/i);
  });

  test('sorting by name and by specialty gives the same order every time, and the page says which', async ({ page }) => {
    const names = () => texts(page.locator('.doctor-name'));
    const sorted = (list) => [...list].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    const byName = await names();
    expect(byName).toEqual(sorted(byName));
    await expect(status(page)).toHaveText('6 doctors found. Sorted by name, A to Z.');

    await page.getByLabel('Sort doctors by').selectOption('specialty');
    await expect(status(page)).toHaveText('6 doctors found. Sorted by specialty, then name.');
    const specialties = await texts(page.locator('.doctor-specialty'));
    expect(specialties).toEqual(sorted(specialties));
    const first = await names();
    await page.getByLabel('Sort doctors by').selectOption('name');
    await page.getByLabel('Sort doctors by').selectOption('specialty');
    expect(await names()).toEqual(first);
  });

  test('changing the sort keeps the filters (it used to redraw the whole list)', async ({ page }) => {
    await page.locator('#specialty').selectOption('general practitioner');
    await expect(page.locator('.doctor-card')).toHaveCount(1);
    await page.getByLabel('Sort doctors by').selectOption('specialty');
    await expect(page.locator('.doctor-card')).toHaveCount(1);
    await expect(status(page)).toContainText('1 doctor found.');
  });

  test('a filter with no match shows the empty message and the count says none', async ({ page }) => {
    await page.locator('#specialty').selectOption('dentist');
    await expect(page.locator('.doctor-card')).toHaveCount(0);
    await expect(page.locator('.no-results')).toContainText('No doctors found matching your criteria');
    await expect(status(page)).toHaveText('No doctors found.');
  });
});

test.describe('pharmacies', () => {
  // pharmacies.js still calls Leaflet (L) without checking that it loaded, and the fixture blocks the map library,
  // so the page throws "L is not defined" after the list is drawn. The same known bug is allow-listed in smoke.spec.js.
  test.use({ allowedPageErrors: [/^L is not defined$/] });
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/pharmacies.html');
    await expect(page.locator('.pharmacy-card')).toHaveCount(6);
  });

  test('name, distance and home delivery are offered, and no card shows a rating or a made up distance', async ({ page }) => {
    await expect(page.getByLabel('Sort pharmacies by').locator('option')).toHaveText(['Name (A to Z)', 'Distance', 'Home delivery first']);
    const text = await page.locator('.pharmacies-list').innerText();
    expect(text).not.toMatch(/rating|miles away/i);
    await expect(page.locator('.pharmacy-distance')).toHaveCount(0);
  });

  test('the type filter works for every type it offers', async ({ page }) => {
    await page.locator('#pharmacy-type').selectOption('24-hour');
    await expect(page.locator('.pharmacy-card')).toHaveCount(1);
    await page.locator('#pharmacy-type').selectOption('chain pharmacy');
    await expect(page.locator('.pharmacy-card')).toHaveCount(2);
    await page.locator('#pharmacy-type').selectOption('hospital pharmacy');
    await expect(page.locator('.pharmacy-card')).toHaveCount(1);
    await page.locator('#pharmacy-type').selectOption('independent');
    await expect(page.locator('.pharmacy-card')).toHaveCount(2);
  });

  test('distance sorting without a location says so and keeps A to Z, with no distances shown', async ({ page }) => {
    await page.getByLabel('Sort pharmacies by').selectOption('distance');
    await expect(status(page)).toHaveText('6 pharmacies found. Distance sorting needs your location, so the list is sorted A to Z.');
    const names = await texts(page.locator('.pharmacy-name'));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    await expect(page.locator('.pharmacy-distance')).toHaveCount(0);
  });

  test('with a saved location the distances are shown and the list is in distance order', async ({ page }) => {
    await setPlace(page, 'Kolkata');
    await page.getByLabel('Sort pharmacies by').selectOption('distance');
    await expect(status(page)).toContainText('Sorted by distance from your saved location.');
    await expect(page.locator('.pharmacy-distance')).toHaveCount(6);
    const km = (await texts(page.locator('.pharmacy-distance'))).map((t) => parseFloat(t.replace(/,/g, '')));
    expect(km.every(Number.isFinite)).toBe(true);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    const first = await texts(page.locator('.pharmacy-name'));
    await page.getByLabel('Sort pharmacies by').selectOption('name');
    await page.getByLabel('Sort pharmacies by').selectOption('distance');
    expect(await texts(page.locator('.pharmacy-name'))).toEqual(first);
  });

  test('home delivery first puts the pharmacies that list it on top, then A to Z', async ({ page }) => {
    await page.getByLabel('Sort pharmacies by').selectOption('delivery');
    await expect(status(page)).toContainText('home delivery come first, then A to Z');
    const flags = [];
    for (const card of await page.locator('.pharmacy-card').all()) {
      flags.push((await card.locator('.service-tag').allInnerTexts()).includes('Home Delivery'));
    }
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(flags[0]).toBe(true);
    expect(flags[flags.length - 1]).toBe(false);
  });

  test('a filter with no match shows the empty message', async ({ page }) => {
    await page.locator('#pharmacy-type').selectOption('24-hour');
    await page.locator('#services').selectOption('vaccines');
    await expect(page.locator('.pharmacy-card')).toHaveCount(0);
    await expect(page.locator('.no-results')).toContainText('No pharmacies found');
    await expect(status(page)).toHaveText('No pharmacies found.');
  });
});

test.describe('hospitals', () => {
  const sample = () => {
    const base = (id, name, extra) => Object.assign({
      id, name, type: 'clinic', district: 'Kolkata', address: null, phone: null, hours: null, services: ['Surgery'],
      lat: null, lng: null, verified: false, reviewState: 'pending', verifiedBy: null, source: null, lastChecked: null, reviewLog: []
    }, extra);
    return {
      schemaVersion: 1,
      facilities: [
        base('h1', 'Sample Alpha Clinic (no position)', {}),
        base('h2', 'Sample Bravo Clinic (far)', { lat: 24.5, lng: 88.0, hours: '09:00-17:00' }),
        base('h3', 'Sample Charlie Clinic (near)', { lat: 22.58, lng: 88.37 }),
        base('h4', 'Sample Delta Clinic (no position, hours)', { hours: 'Open 24 hours' })
      ]
    };
  };
  const names = (page) => texts(page.locator('.hospital-name'));

  test('the hours sort is not offered while no record lists hours', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card')).toHaveCount(REAL.facilities.length);
    await expect(page.locator('#sort-by option')).toHaveText(['Name (A to Z)', 'Distance']);
  });

  test('records without a position go last when sorting by distance and show no distance', async ({ page }) => {
    await page.route('**/assets/data/facilities.json', (route) => route.fulfill({ json: sample() }));
    await page.goto('/pages/hospitals.html');
    await setPlace(page, 'Kolkata');
    await page.locator('#sort-by').selectOption('distance');
    await expect(page.locator('.hospital-card')).toHaveCount(4);
    expect(await names(page)).toEqual([
      'Sample Charlie Clinic (near)', 'Sample Bravo Clinic (far)',
      'Sample Alpha Clinic (no position)', 'Sample Delta Clinic (no position, hours)'
    ]);
    await expect(page.locator('.hospital-distance')).toHaveCount(2);
    await expect(page.locator('.hospital-card').nth(2).locator('.btn-directions')).toHaveCount(0);
  });

  test('"Hours listed first" appears when a record lists hours and puts those first, then A to Z', async ({ page }) => {
    await page.route('**/assets/data/facilities.json', (route) => route.fulfill({ json: sample() }));
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('#sort-by option')).toHaveText(['Name (A to Z)', 'Distance', 'Hours listed first']);
    await page.locator('#sort-by').selectOption('hours');
    expect(await names(page)).toEqual([
      'Sample Bravo Clinic (far)', 'Sample Delta Clinic (no position, hours)',
      'Sample Alpha Clinic (no position)', 'Sample Charlie Clinic (near)'
    ]);
    await expect(status(page)).toContainText('Entries that list opening hours come first, then A to Z.');
  });

  test('no match after filtering says so in the live status', async ({ page }) => {
    await page.route('**/assets/data/facilities.json', (route) => route.fulfill({ json: sample() }));
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card')).toHaveCount(4);
    await page.getByLabel('Search by name, area or service').fill('zzzz');
    await expect(page.locator('.no-results')).toBeVisible();
    await expect(status(page)).toHaveText('No facilities found.');
  });
});
