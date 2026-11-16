// Journey: the status labels and legend on the hospital, doctor, pharmacy and ambulance pages (Issue #110).
// The map library is blocked in tests, so a very small stand-in for Leaflet is put on the page before its scripts
// run. It only records the text each map popup is given, which is enough to compare the map with the list.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8')).facilities;
const legendLabels = (page) => page.locator('#status-legend .verify-badge').allInnerTexts();

async function fakeMap(page) {
  await page.addInitScript(() => {
    window.__popups = [];
    const layer = { addTo() { return this; }, bindPopup(html) { window.__popups.push(html); return this; } };
    const map = { setView() { return this; }, fitBounds() {}, removeLayer() {}, addLayer() {} };
    window.L = {
      map() { return map; }, tileLayer() { return layer; }, marker() { return layer; }, icon() { return {}; },
      // pharmacies.js calls it with `new`, so it has to be a plain function
      featureGroup: function () { return { getBounds() { return { pad() { return {}; } }; } }; }
    };
  });
}

// the popup's visible text, with the markup taken off
const popupText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function sampleData() {
  const base = (id, name, extra) => Object.assign({
    id, name, type: 'clinic', district: 'Kolkata', address: null, phone: null, hours: null, services: ['Surgery'],
    lat: 22.57, lng: 88.36, verified: false, reviewState: 'pending', verifiedBy: null, source: null, lastChecked: null, reviewLog: []
  }, extra);
  const evidence = { reviewState: 'verified', verifiedBy: 'Sample reviewer', source: 'https://example.org/sample', lastChecked: '2026-10-20' };
  const noStatus = base('s4', 'Sample No Status Clinic', {});
  delete noStatus.reviewState;
  delete noStatus.verified;
  return {
    schemaVersion: 1,
    facilities: [
      base('s1', 'Sample Verified Clinic', evidence),
      base('s2', 'Sample Pending Clinic', {}),
      base('s3', 'Sample Old Check Clinic', Object.assign({}, evidence, { lastChecked: '2026-01-02' })),
      noStatus,
      base('s5', 'Sample Made Up Clinic', Object.assign({ synthetic: true }, evidence))
    ]
  };
}

test.describe('hospitals', () => {
  test('real data: every card is "Not verified", the legend explains only that label, and the map says the same', async ({ page }) => {
    await fakeMap(page);
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card')).toHaveCount(REAL.length);
    await expect(page.locator('.hospital-card .verify-badge')).toHaveText(Array(REAL.length).fill('Not verified'));
    await expect(page.locator('#status-legend')).toBeVisible();
    expect(await legendLabels(page)).toEqual(['Not verified']);
    await expect(page.locator('#status-legend')).toContainText('A record with none is never shown as verified');

    const popups = (await page.evaluate(() => window.__popups)).map(popupText);
    expect(popups).toHaveLength(REAL.length);
    popups.forEach((text) => expect(text).toContain('Not verified'));
    expect(popups.some((text) => text.includes('Verified') && !text.includes('Not verified'))).toBe(false);
  });

  test('each state is worded the same on the card, in the legend and on the map, and nothing is verified without evidence', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T10:00:00Z'));
    await fakeMap(page);
    await page.route('**/assets/data/facilities.json', (route) => route.fulfill({ json: sampleData() }));
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card')).toHaveCount(5);

    const byName = {};
    for (const card of await page.locator('.hospital-card').all()) {
      byName[(await card.locator('.hospital-name').innerText()).trim()] = (await card.locator('.verify-badge').innerText()).trim();
    }
    expect(byName).toEqual({
      'Sample Verified Clinic': 'Verified',
      'Sample Pending Clinic': 'Not verified',
      'Sample Old Check Clinic': 'Needs re-checking',
      'Sample No Status Clinic': 'Status unavailable',
      'Sample Made Up Clinic': 'Sample data'
    });
    expect(await legendLabels(page)).toEqual(['Verified', 'Not verified', 'Needs re-checking', 'Sample data', 'Status unavailable']);

    const popups = (await page.evaluate(() => window.__popups)).map(popupText);
    for (const [name, badge] of Object.entries(byName)) {
      const popup = popups.find((text) => text.includes(name));
      expect(popup, name).toBeDefined();
      expect(popup, name).toMatch(new RegExp(`${badge}$`));
    }
  });

  test('the label is words plus a symbol, not colour alone', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const badge = page.locator('.hospital-card .verify-badge').first();
    await expect(badge).toHaveText('Not verified');
    expect(await badge.getAttribute('data-icon')).toBeTruthy();
    const before = await badge.evaluate((el) => getComputedStyle(el, '::before').content);
    expect(before).toContain('?');
    expect(await badge.evaluate((el) => getComputedStyle(el).borderTopWidth)).not.toBe('0px');
  });
});

for (const [name, url, card, popups] of [
  ['doctors', '/pages/doctors.html', '.doctor-card', false],
  ['pharmacies', '/pages/pharmacies.html', '.pharmacy-card', true],
  ['ambulances', '/pages/ambulances.html', '.ambulance-item', true]
]) {
  test.describe(name, () => {
    test(`every card says "Sample data", the legend explains it, and nothing says verified${popups ? ', and the map popups agree' : ''}`, async ({ page }) => {
      await fakeMap(page);
      await page.goto(url);
      const count = await page.locator(card).count();
      expect(count).toBeGreaterThan(0);
      await expect(page.locator(`${card} .verify-badge`)).toHaveText(Array(count).fill('Sample data'));
      expect(await legendLabels(page)).toEqual(['Sample data']);
      await expect(page.locator('#status-legend')).toContainText('not a real provider');
      expect(await page.locator('main').innerText()).not.toMatch(/\bVerified\b/);
      if (popups) {
        const texts = (await page.evaluate(() => window.__popups)).map(popupText);
        expect(texts).toHaveLength(count);
        texts.forEach((text) => expect(text).toContain('Sample data'));
      }
    });
  });
}
