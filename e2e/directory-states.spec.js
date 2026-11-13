// Journey: what the doctor, hospital, pharmacy and ambulance lists show when there is nothing to list (Issue #85).
// Three different situations look different: no matches for the filters, no data at all, and a failure with Try again.
// The doctor, pharmacy and ambulance lists are built from data inside their scripts, so a failure there is
// injected: the first time a card is added to the page, the browser's appendChild is made to throw once.
const { test, expect } = require('./fixtures');

const NOT_LIVE = /\b(live|open now|available now|real[- ]time|currently available)\b/i;

async function failOnce(page, cardClass) {
  await page.addInitScript((cls) => {
    let done = false;
    const original = Element.prototype.appendChild;
    Element.prototype.appendChild = function (child) {
      if (!done && child && child.className === cls) {
        done = true;
        throw new Error('injected failure');
      }
      return original.call(this, child);
    };
  }, cardClass);
}

test.describe('hospitals', () => {
  test('no data is its own state: nothing to retry, nothing to clear, emergency line shown', async ({ page }) => {
    await page.route('**/assets/data/facilities.json', (route) => route.fulfill({ json: { schemaVersion: 1, facilities: [] } }));
    await page.goto('/pages/hospitals.html');
    const state = page.locator('.hospitals-list .state');
    await expect(state).toHaveAttribute('data-state', 'empty');
    await expect(state).toContainText('No facilities are listed right now');
    await expect(state).toContainText('emergency number');
    await expect(state.getByRole('button')).toHaveCount(0);
    await expect(page.locator('#directory-status')).toHaveText('No facilities are listed right now.');
    expect(await state.innerText()).not.toMatch(NOT_LIVE);
  });

  test('no matches is a different state, with a button that clears the search and filters', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospital-card').first()).toBeVisible();
    await page.getByLabel('Search by name, area or service').fill('zzzz-not-a-hospital');
    const state = page.locator('.hospitals-list .state');
    await expect(state).toHaveAttribute('data-state', 'empty');
    await expect(state).toHaveAttribute('role', 'status');
    await expect(state).toContainText('No facilities found matching your criteria');
    await expect(state.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await state.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(page.getByLabel('Search by name, area or service')).toBeFocused();
    await expect(page.locator('.hospital-card').first()).toBeVisible();
    await expect(page.locator('.hospitals-list .state')).toHaveCount(0);
  });

  test('a failed load is an alert with Try again, not an empty list', async ({ page }) => {
    await page.route('**/assets/data/facilities.json', (route) => route.abort());
    await page.goto('/pages/hospitals.html');
    const state = page.locator('.hospitals-list .state');
    await expect(state).toHaveAttribute('data-state', 'error', { timeout: 15000 });
    await expect(state).toHaveAttribute('role', 'alert');
    await expect(state).toContainText('emergency number');
    await expect(state.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(await state.innerText()).not.toContain('No facilities found');
  });
});

test.describe('doctors', () => {
  test('no matches: an empty state, not an error, and the clear button brings the list back', async ({ page }) => {
    await page.goto('/pages/doctors.html');
    await expect(page.locator('.doctor-card')).toHaveCount(6);
    await page.getByLabel('Search by specialty, doctor name, or condition').fill('zzzz-nobody');
    const state = page.locator('.doctors-list .state');
    await expect(state).toHaveAttribute('data-state', 'empty');
    await expect(state).toContainText('No doctors found matching your criteria');
    await expect(state).toContainText('emergency number');
    await expect(page.locator('.doctor-card')).toHaveCount(0);
    await state.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(page.locator('.doctor-card')).toHaveCount(6);
    await expect(page.getByLabel('Search by specialty, doctor name, or condition')).toBeFocused();
  });

  test('a failure while building the list shows an alert, and Try again works from the keyboard', async ({ page }) => {
    await failOnce(page, 'doctor-card');
    await page.goto('/pages/doctors.html');
    const state = page.locator('.doctors-list .state');
    await expect(state).toHaveAttribute('data-state', 'error');
    await expect(state).toHaveAttribute('role', 'alert');
    await expect(state).toContainText('The list of doctors could not be shown');
    await expect(state).toContainText('emergency number');
    expect(await state.innerText()).not.toMatch(/injected failure/);
    const retry = state.getByRole('button', { name: 'Try again' });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.doctor-card')).toHaveCount(6);
    await expect(page.locator('.doctors-list .state')).toHaveCount(0);
  });
});

test.describe('pharmacies', () => {
  test('no matches: an empty state with the clear button', async ({ page }) => {
    await page.goto('/pages/pharmacies.html');
    await expect(page.locator('.pharmacy-card')).toHaveCount(6);
    await page.getByLabel('Search by pharmacy name or medicine').fill('zzzz-nothing');
    const state = page.locator('.pharmacies-list .state');
    await expect(state).toHaveAttribute('data-state', 'empty');
    await expect(state).toContainText('No pharmacies found matching your criteria');
    await state.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(page.locator('.pharmacy-card')).toHaveCount(6);
  });

  test('without the map library the list still works and the page says the map is missing', async ({ page, problems }) => {
    await page.goto('/pages/pharmacies.html');
    expect(problems.blocked.some((request) => request.includes('leaflet'))).toBe(true);
    await expect(page.locator('.pharmacy-card')).toHaveCount(6);
    await expect(page.getByRole('status').filter({ hasText: 'The map could not be loaded' })).toBeVisible();
    await expect(page.locator('#map')).toBeHidden();
    // a filter still works after the map failed
    await page.getByLabel('Search by pharmacy name or medicine').fill('greenleaf');
    await expect(page.locator('.pharmacy-card')).toHaveCount(1);
    expect(problems.pageErrors).toEqual([]);
  });

  test('a failure while building the list shows an alert and Try again brings the list back', async ({ page }) => {
    await failOnce(page, 'pharmacy-card');
    await page.goto('/pages/pharmacies.html');
    const state = page.locator('.pharmacies-list .state');
    await expect(state).toHaveAttribute('data-state', 'error');
    await expect(state).toContainText('The list of pharmacies could not be shown');
    await state.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.pharmacy-card')).toHaveCount(6);
  });
});

test.describe('ambulances', () => {
  test('a failure while building the list keeps the emergency buttons and offers Try again', async ({ page }) => {
    await failOnce(page, 'ambulance-item');
    await page.goto('/pages/ambulances.html');
    const state = page.locator('.ambulance-list .state');
    await expect(state).toHaveAttribute('data-state', 'error');
    await expect(state).toContainText('The list of ambulance services could not be shown');
    await expect(state).toContainText('emergency number');
    await expect(page.locator('.btn-call-911')).toBeVisible();
    await expect(page.locator('#relief-emergency-sos-trigger')).toBeVisible();
    await state.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.ambulance-item')).toHaveCount(4);
  });

  test('the page without JavaScript says so and points to the emergency numbers', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    // like every other test, nothing may leave the local site
    await context.route((url) => url.origin !== new URL(baseURL).origin, (route) => route.abort('blockedbyclient'));
    const page = await context.newPage();
    try {
      await page.goto('/pages/ambulances.html', { waitUntil: 'domcontentloaded' });
      const text = await page.locator('.ambulance-list').innerText();
      expect(text).toContain('In an emergency call 112 or 108');
    } finally {
      await context.close();
    }
  });
});
