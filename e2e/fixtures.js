// Shared test setup. Every spec imports { test, expect } from here instead of @playwright/test.
//
// What it guarantees for every test:
//   - nothing leaves the local site: fonts, icons, map tiles, geocoding and the map library are
//     blocked, so tests are repeatable offline and can never reach a real service
//   - emergency actions are mocked: window.open is replaced, tel: and sms: links are never followed
//     (clicks are recorded instead) and geolocation is "denied" unless a test opts in
//   - an uncaught page error fails the test, and on failure the console output, blocked requests and
//     recorded emergency actions are attached to the report next to the trace and screenshot
//   - first-party requests that failed (4xx, 5xx or a dropped connection) and console errors are recorded in
//     `problems` but do not fail a test by themselves. The smoke helpers in helpers.js turn them into failures.
const base = require('@playwright/test');
const { expect } = base;

const GUARD_SCRIPT = () => {
  window.__relief = { opened: [], links: [] };
  window.open = function (url) {
    window.__relief.opened.push(String(url));
    return null;
  };
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[href^="tel:"], a[href^="sms:"]');
    if (link) {
      event.preventDefault();
      window.__relief.links.push(link.getAttribute('href'));
    }
  }, true);
  // Default: location permission denied. Tests that need a position call useGeolocation().
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: function (ok, fail) {
        setTimeout(function () { fail && fail({ code: 1, message: 'User denied Geolocation' }); }, 0);
      },
      watchPosition: function () { return 0; },
      clearWatch: function () {}
    }
  });
};

const test = base.test.extend({
  // Regular expressions for page errors a spec knowingly tolerates (each one should point at a known bug).
  allowedPageErrors: [[], { option: true }],
  problems: [async ({}, use) => {
    // consoleErrors: { text, url } with the address the browser says the message came from.
    // firstParty: { url, status, failure } for requests to this site that came back 4xx, 5xx or never arrived.
    await use({ pageErrors: [], console: [], blocked: [], consoleErrors: [], firstParty: [] });
  }, { scope: 'test' }],

  page: async ({ page, baseURL, problems, allowedPageErrors }, use, testInfo) => {
    const origin = new URL(baseURL).origin;

    await page.context().route((url) => url.origin !== origin, (route) => {
      problems.blocked.push(route.request().method() + ' ' + route.request().url());
      return route.abort('blockedbyclient');
    });
    await page.addInitScript(GUARD_SCRIPT);

    page.on('pageerror', (error) => problems.pageErrors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') problems.console.push(msg.type() + ': ' + msg.text());
      if (msg.type() === 'error') problems.consoleErrors.push({ text: msg.text(), url: msg.location().url || '' });
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && response.status() >= 400) {
        problems.firstParty.push({ url: url.pathname, status: response.status(), failure: '' });
      }
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin) {
        problems.firstParty.push({ url: url.pathname, status: 0, failure: (request.failure() || {}).errorText || 'failed' });
      }
    });

    await use(page);

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed || problems.pageErrors.length) {
      const guard = await page.evaluate(() => window.__relief).catch(() => null);
      await testInfo.attach('console.txt', { body: problems.console.join('\n') || '(empty)', contentType: 'text/plain' });
      await testInfo.attach('blocked-external-requests.txt', { body: problems.blocked.join('\n') || '(none)', contentType: 'text/plain' });
      await testInfo.attach('emergency-actions.json', { body: JSON.stringify(guard, null, 2) || 'null', contentType: 'application/json' });
    }
    const unexpected = problems.pageErrors.filter((message) => !allowedPageErrors.some((re) => re.test(message)));
    expect(unexpected, 'uncaught page errors').toEqual([]);
  }
});

module.exports = { test, expect };
