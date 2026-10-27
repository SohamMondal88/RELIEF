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

// ---- Network interception -------------------------------------------------------------------------
// Reusable helpers for flaky-network tests (see docs/E2E_TESTING.md). Call them before page.goto.
// `matcher` is anything page.route accepts: a glob string, a RegExp or a (URL) => boolean function.
// Every helper that intercepts returns { requests }, the URLs it has caught, so a test can prove the
// failure it describes really happened instead of passing because nothing matched.
// Nothing here ever forwards a request to a real third-party host: outside requests are only ever
// aborted, answered with a fake response or held, and fixtures.js already blocks the rest.

const THIRD_PARTY_BODIES = {
  // Content types are what a CDN would send, so the browser applies the same parsing rules.
  '.css': { contentType: 'text/css', body: '' },
  '.js': { contentType: 'text/javascript', body: '' }
};

function intercept(page, matcher, handler) {
  const requests = [];
  const held = [];
  const done = page.route(matcher, (route) => {
    requests.push(route.request().url());
    return handler(route, held);
  });
  return done.then(() => ({ requests, held }));
}

// The request fails at once, like a dropped connection or a DNS error.
async function failRequests(page, matcher, { reason = 'connectionreset' } = {}) {
  const { requests } = await intercept(page, matcher, (route) => route.abort(reason));
  return { requests };
}

// The server answers with an error status (default 503 Service Unavailable).
async function errorResponse(page, matcher, { status = 503, body = 'Service unavailable' } = {}) {
  const { requests } = await intercept(page, matcher, (route) => route.fulfill({ status, contentType: 'text/plain', body }));
  return { requests };
}

// The request is held for delayMs and then goes through to the local server unchanged.
// Only for same-origin requests (a held outside request would reach the real host).
async function delayRequests(page, matcher, delayMs) {
  const { requests } = await intercept(page, matcher, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue().catch(() => {});
  });
  return { requests };
}

// The request stays pending until the test calls release() (goes through to the local server) or
// fail() (connection error). Use it to look at the loading state without racing a timer.
async function holdRequests(page, matcher) {
  const { requests, held } = await intercept(page, matcher, (route) => { held.push(route); });
  const settle = (action) => Promise.all(held.splice(0).map((route) => action(route).catch(() => {})));
  return {
    requests,
    pending: () => held.length,
    release: () => settle((route) => route.continue()),
    fail: () => settle((route) => route.abort('connectionreset'))
  };
}

// Everything that is not the site itself (fonts, icon fonts, Leaflet, map tiles, Nominatim, analytics).
//   abort   the request fails (blocked network, ad blocker, DNS)
//   error   the host answers 503
//   empty   the host answers 200 with an empty file (captive portal, proxy)
//   hang    the request never finishes (a very slow CDN)
async function failThirdParty(page, { baseURL, mode = 'abort' }) {
  const origin = new URL(baseURL).origin;
  const outside = (url) => url.origin !== origin && /^https?:$/.test(url.protocol);
  const handlers = {
    abort: (route) => route.abort('connectionreset'),
    error: (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service unavailable' }),
    empty: (route) => {
      const ext = (new URL(route.request().url()).pathname.match(/\.(css|js)$/) || [])[0];
      const type = THIRD_PARTY_BODIES[ext] || { contentType: 'text/plain', body: '' };
      return route.fulfill({ status: 200, ...type });
    },
    hang: () => {}
  };
  if (!handlers[mode]) throw new Error('failThirdParty: unknown mode ' + mode);
  const { requests } = await intercept(page, outside, handlers[mode]);
  return { requests };
}

// Connection lost / back, for the whole browser context (pages already open and new ones).
async function goOffline(page) {
  await page.context().setOffline(true);
}

async function goOnline(page) {
  await page.context().setOffline(false);
}

// First visit: wait until the service worker controls the page and has cached the pages and scripts.
async function waitForOfflineCopy(page, path) {
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const names = await caches.keys();
    if (!names.length) return 0;
    return (await (await caches.open(names[0])).keys()).length;
  })).toBeGreaterThan(3);
}

module.exports = {
  useGeolocation, openHome, signUp, storedJson, relief,
  failRequests, errorResponse, delayRequests, holdRequests, failThirdParty, goOffline, goOnline, waitForOfflineCopy
};
