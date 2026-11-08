const { expect } = require('./fixtures');

// Calls made before page.goto. Init scripts run in the order they were added, so these override the defaults.
async function useGeolocation(page, { lat, lng }) {
  await page.addInitScript(({ lat, lng }) => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: function (ok) {
          setTimeout(function () {
            ok({ coords: { latitude: lat, longitude: lng, accuracy: 25 }, timestamp: Date.now() });
          }, 0);
        },
        watchPosition: function () { return 0; },
        clearWatch: function () {}
      }
    });
  }, { lat, lng });
}

// The home page shows a 3 second splash screen before the content appears.
async function openHome(page) {
  await page.goto('/index.html');
  await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
}

// Call before page.goto. Brings back the first-visit tour that fixtures.js switches off.
async function showTour(page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('relief_onboarding_status'); } catch (e) { /* storage blocked */ }
  });
}

async function signUp(page, { name = 'Test Person', email = 'test.person@example.com', password = 'secret123' } = {}) {
  await page.goto('/pages/signup.html');
  await page.getByLabel('Full Name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('#signup-password').fill(password);
  await page.locator('#signup-confirm-password').fill(password);
  await page.locator('#terms').check();
  await page.getByRole('button', { name: 'Sign Up' }).click();
}

async function storedJson(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
}

async function relief(page) {
  return page.evaluate(() => window.__relief);
}

module.exports = { useGeolocation, openHome, showTour, signUp, storedJson, relief };
