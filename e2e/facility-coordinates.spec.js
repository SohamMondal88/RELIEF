// Journey: a facility with a missing or broken map location stays in the list, gets no pin and says so.
// The map library is blocked in these tests, so a small stand-in for Leaflet records which pins would be drawn.
const { test, expect } = require('./fixtures');

const record = (id, name, extra) => Object.assign({ id, name, type: 'hospital', district: 'Testpur', phone: '+91 33 5550 0100' }, extra);

const DATA = {
  schemaVersion: 1,
  facilities: [
    record('c-ok', 'Pin Number Hospital', { lat: 22.57, lng: 88.36 }),
    record('c-text', 'Pin Text Hospital', { lat: '23.5', lng: ' 87.3 ' }),
    record('c-empty', 'Empty Strings Hospital', { lat: '', lng: '' }),
    record('c-null', 'Null Hospital', { lat: null, lng: null }),
    record('c-zero', 'Zero Zero Hospital', { lat: 0, lng: 0 }),
    record('c-range', 'Out Of Range Hospital', { lat: 95, lng: 88.3 }),
    record('c-word', 'Not A Number Hospital', { lat: 'Infinity', lng: 'north' }),
    record('c-half', 'Half A Pair Hospital', { lat: 22.5 })
  ]
};

const fakeLeaflet = () => {
  window.__pins = [];
  const chain = () => {
    const self = {};
    ['setView', 'fitBounds', 'addTo', 'bindPopup', 'removeLayer', 'pad'].forEach((name) => { self[name] = () => self; });
    self.getBounds = () => self;
    return self;
  };
  window.L = {
    map: chain,
    tileLayer: chain,
    featureGroup: chain,
    marker: (latlng) => {
      const pin = chain();
      pin.addTo = () => { window.__pins.push(latlng); return pin; };
      return pin;
    }
  };
};

test.describe('facility directory: unusable map locations', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeLeaflet);
    await page.route('**/assets/data/facilities.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(DATA)
    }));
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card')).toHaveCount(DATA.facilities.length);
  });

  test('every facility is still listed, with a count of the ones that have no map location', async ({ page }) => {
    await expect(page.locator('#directory-status')).toHaveText('8 facilities found. 6 have no map location.');
    await expect(page.locator('.hospital-card .hospital-name')).toHaveText(DATA.facilities.map((f) => f.name).sort());
  });

  test('only usable locations become pins, and a numeric string is read as the number it is', async ({ page }) => {
    const pins = await page.evaluate(() => window.__pins);
    expect(pins).toEqual([[22.57, 88.36], [23.5, 87.3]]);
  });

  test('a card without a usable location says so and has no Directions button, the others keep both', async ({ page }) => {
    const cards = page.locator('.hospital-card');
    await expect(page.locator('.btn-directions')).toHaveCount(2);
    for (const name of ['Pin Number Hospital', 'Pin Text Hospital']) {
      const card = cards.filter({ hasText: name });
      await expect(card.locator('.map-location')).toHaveCount(0);
      await expect(card.locator('.btn-directions')).toHaveCount(1);
    }
    for (const name of ['Empty Strings Hospital', 'Null Hospital', 'Zero Zero Hospital', 'Out Of Range Hospital', 'Not A Number Hospital', 'Half A Pair Hospital']) {
      const card = cards.filter({ hasText: name });
      await expect(card.locator('.map-location')).toContainText('Not available');
      await expect(card.locator('.btn-directions')).toHaveCount(0);
      await expect(card.locator('a.btn-call')).toHaveCount(1);
    }
  });

  test('Directions for a text coordinate opens the real place, not 0,0', async ({ page }) => {
    await page.locator('.hospital-card', { hasText: 'Pin Text Hospital' }).locator('.btn-directions').click();
    const opened = await page.evaluate(() => window.__relief.opened);
    expect(opened).toEqual(['https://www.google.com/maps/dir/?api=1&destination=23.5,87.3']);
  });

  test('search and filters keep working on records without a location', async ({ page }) => {
    await page.getByLabel('Search by name, area or service').fill('Zero Zero');
    await expect(page.locator('.hospital-card')).toHaveCount(1);
    await expect(page.locator('#directory-status')).toHaveText('1 facility found. 1 has no map location.');
    await page.getByLabel('Search by name, area or service').fill('');
    await expect(page.locator('.hospital-card')).toHaveCount(DATA.facilities.length);
  });
});
