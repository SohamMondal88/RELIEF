// Journey: narrow the facility list with several filters, see which are active, reset them, and get
// help when nothing matches (Issue #48). The real data file has no opening hours and no accessibility
// information yet, so the tests that need them answer facilities.json with made up records (nothing
// real is touched, and the records are not shown as real anywhere).
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8'));
const FACILITIES = DATA.facilities;
const cards = (page) => page.locator('.hospital-card');
const status = (page) => page.locator('#directory-status');

// 10:00 on 10 November 2026 in India.
const MORNING = '2026-11-10T04:30:00Z';
const EVENING = '2026-11-10T14:30:00Z';

function sampleData() {
  const check = { reviewState: 'verified', verifiedBy: 'Sample reviewer', source: 'https://example.org/sample', lastChecked: '2026-10-20' };
  const base = (id, name, extra) => Object.assign({
    id, name, type: 'clinic', district: 'Kolkata', address: null, phone: null, hours: null, services: ['Surgery'],
    lat: 22.57, lng: 88.36, verified: false, reviewState: 'pending', verifiedBy: null, source: null, lastChecked: null, reviewLog: []
  }, extra);
  return {
    schemaVersion: 1,
    facilities: [
      base('s1', 'Sample Day Clinic', Object.assign({ hours: '09:00-17:00', accessibility: ['Wheelchair access'], services: ['Surgery', 'Emergency Care'] }, check)),
      base('s2', 'Sample Night Clinic', Object.assign({ hours: '20:00-06:00', accessibility: ['Wheelchair access'] }, check)),
      base('s3', 'Sample Always Open Clinic', Object.assign({ hours: 'Open 24 hours', accessibility: ['Accessible toilet'], district: 'Howrah' }, check)),
      base('s4', 'Sample Unknown Hours Clinic', { hours: '09:00-17:00', accessibility: ['Wheelchair access'] }),
      base('s5', 'Sample Weekday Hours Clinic', Object.assign({ hours: 'Mon-Fri 9-5', accessibility: ['Wheelchair access'] }, check)),
      base('s6', 'Sample Plain Clinic', {})
    ]
  };
}

async function useSampleData(page, isoTime) {
  await page.clock.setFixedTime(new Date(isoTime));
  await page.route('**/assets/data/facilities.json', (route) => route.fulfill({ json: sampleData() }));
}

test.describe('active filters and reset (real data)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(FACILITIES.length);
  });

  test('no chips and no reset button until a filter is on', async ({ page }) => {
    await expect(page.locator('#active-filters')).toBeHidden();
    await page.locator('#location').selectOption('Kolkata');
    await expect(page.locator('#active-filters')).toBeVisible();
    await expect(page.locator('.filter-chip')).toHaveText(['Area: Kolkata ×']);
  });

  test('combined filters show one chip each, a chip removes only its own filter, reset clears all', async ({ page }) => {
    const first = FACILITIES.find((f) => f.district === 'Kolkata' && f.services.length);
    const service = first.services[0];
    const word = first.name.split(' ')[0].toLowerCase();
    await page.locator('#location').selectOption('Kolkata');
    await page.locator('#services').selectOption(service);
    await page.getByLabel('Search by name, area or service').fill(word);
    const expected = FACILITIES.filter((f) => f.district === 'Kolkata' && f.services.includes(service)
      && `${f.name} ${f.district} ${f.services.join(' ')}`.toLowerCase().includes(word)).length;
    expect(expected).toBeGreaterThan(0);
    await expect(cards(page)).toHaveCount(expected);
    await expect(page.locator('.filter-chip')).toHaveCount(3);
    await expect(status(page)).toContainText(`${expected} ${expected === 1 ? 'facility found' : 'facilities found'}`);

    await page.getByRole('button', { name: `Remove filter Search: "${word}"` }).click();
    await expect(page.locator('.filter-chip')).toHaveCount(2);
    await expect(page.getByLabel('Search by name, area or service')).toBeFocused();
    const both = FACILITIES.filter((f) => f.district === 'Kolkata' && f.services.includes(service)).length;
    await expect(cards(page)).toHaveCount(both);

    await page.getByRole('button', { name: 'Reset all filters' }).click();
    await expect(cards(page)).toHaveCount(FACILITIES.length);
    await expect(page.locator('#active-filters')).toBeHidden();
    await expect(page.locator('#location')).toHaveValue('');
    await expect(page.locator('#services')).toHaveValue('');
  });

  test('the Accessibility filter is not offered, and Open now is disabled and says why', async ({ page }) => {
    await expect(page.locator('#accessibility-group')).toBeHidden();
    await expect(page.locator('#open-now')).toBeDisabled();
    await expect(page.locator('#open-now-hint')).toContainText('no facility has verified opening hours');
  });

  test('an empty result offers to remove the filters that cause it, and the buttons work', async ({ page }) => {
    await page.locator('#location').selectOption('Kolkata');
    await page.getByLabel('Verified only').check();
    await expect(cards(page)).toHaveCount(0);
    const empty = page.locator('.no-results');
    await expect(empty).toContainText('No facilities found matching your criteria.');
    await expect(empty).toContainText('Try removing a filter');
    const kolkata = FACILITIES.filter((f) => f.district === 'Kolkata').length;
    await expect(empty.getByRole('button', { name: `Remove Verified only (${kolkata} ${kolkata === 1 ? 'facility' : 'facilities'})` })).toBeVisible();
    // removing the area would still leave nothing (no record is verified), so it is not offered
    await expect(empty.getByRole('button', { name: /^Remove Area/ })).toHaveCount(0);
    expect(kolkata).toBeGreaterThan(0);
    await empty.getByRole('button', { name: /^Remove Verified only/ }).click();
    await expect(cards(page)).toHaveCount(kolkata);
    await expect(page.getByLabel('Verified only')).not.toBeChecked();
    await page.getByLabel('Verified only').check();
    await page.locator('.no-results').getByRole('button', { name: 'Reset all filters' }).click();
    await expect(cards(page)).toHaveCount(FACILITIES.length);
  });

  test('the filter chips and reset fit a 375px phone without going off the screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.locator('#location').selectOption('Kolkata');
    await page.getByLabel('Verified only').check();
    await expect(page.locator('.filter-chip')).toHaveCount(2);
    // (The page already scrolls 2px sideways because of the language switcher, so this checks the new controls themselves.)
    for (const button of await page.locator('.filter-chip, #reset-filters').all()) {
      const box = await button.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
  });
});

test.describe('services, accessibility and open now (sample records)', () => {
  test('the Accessibility filter appears and combines with area and service', async ({ page }) => {
    await useSampleData(page, MORNING);
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(6);
    await expect(page.locator('#accessibility-group')).toBeVisible();
    await expect(page.locator('#accessibility option')).toHaveText(['Any', 'Accessible toilet', 'Wheelchair access']);

    await page.locator('#accessibility').selectOption('Wheelchair access');
    await expect(cards(page)).toHaveCount(4);
    await page.locator('#location').selectOption('Kolkata');
    await page.locator('#services').selectOption('Emergency Care');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Sample Day Clinic');
    await expect(page.locator('.filter-chip')).toHaveText(['Area: Kolkata ×', 'Service: Emergency Care ×', 'Accessibility: Wheelchair access ×']);
  });

  test('Open now lists only verified, readable hours that are open, and says how many were left out', async ({ page }) => {
    await useSampleData(page, MORNING);
    await page.goto('/pages/hospitals.html');
    await expect(cards(page)).toHaveCount(6);
    await expect(page.locator('#open-now')).toBeEnabled();
    await page.locator('#open-now').check();
    await expect(page.locator('.hospital-name')).toHaveText(['Sample Always Open Clinic', 'Sample Day Clinic']);
    // Night Clinic is closed at 10:00. Unknown Hours (not verified), Weekday Hours (text not understood) and Plain (no hours) are unknown.
    await expect(status(page)).toContainText('2 facilities found.');
    await expect(status(page)).toContainText('3 facilities have no verified opening hours and are not shown.');
  });

  test('the same filter at 20:00 India time gives the night clinic instead of the day clinic', async ({ page }) => {
    await useSampleData(page, EVENING);
    await page.goto('/pages/hospitals.html');
    await page.locator('#open-now').check();
    await expect(page.locator('.hospital-name')).toHaveText(['Sample Always Open Clinic', 'Sample Night Clinic']);
  });

  test('an empty combination suggests what to remove, with counts', async ({ page }) => {
    await useSampleData(page, MORNING);
    await page.goto('/pages/hospitals.html');
    await page.locator('#accessibility').selectOption('Accessible toilet');
    await page.locator('#location').selectOption('Kolkata');
    await expect(cards(page)).toHaveCount(0);
    const empty = page.locator('.no-results');
    await expect(empty.getByRole('button', { name: 'Remove Area: Kolkata (1 facility)' })).toBeVisible();
    await expect(empty.getByRole('button', { name: /^Remove Accessibility: Accessible toilet \(5 facilities\)$/ })).toBeVisible();
    await empty.getByRole('button', { name: 'Remove Area: Kolkata (1 facility)' }).click();
    await expect(page.locator('.hospital-name')).toHaveText(['Sample Always Open Clinic']);
  });
});
