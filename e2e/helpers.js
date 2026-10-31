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

// ---------------------------------------------------------------------------
// Smoke checks (Issue #109)
// ---------------------------------------------------------------------------
// The pages every visitor can open without signing in. `ready` is something that only exists once the
// page has finished its own start up, so "loaded" does not depend on a fixed wait.
const SMOKE_ROUTES = [
  { name: 'home', path: '/index.html', ready: '.main-content' },
  { name: 'ambulances', path: '/pages/ambulances.html', ready: '#relief-emergency-sos-trigger' },
  { name: 'hospitals', path: '/pages/hospitals.html', ready: 'main#main-content h1' },
  { name: 'doctors', path: '/pages/doctors.html', ready: 'main#main-content h1' },
  { name: 'appointments', path: '/pages/appointments.html', ready: 'main#main-content h1' },
  { name: 'dashboard', path: '/pages/dashboard.html', ready: 'main#main-content h1' }
];

// Open a route and wait until the page says it is ready and the network has gone quiet.
async function openRoute(page, route) {
  await page.goto(route.path);
  await expect(page.locator(route.ready).first(), route.name + ' (' + route.path + ') never became ready').toBeVisible({ timeout: 8000 });
  await page.waitForLoadState('networkidle');
}

// Everything that went wrong on the current page as readable lines, each naming the route and the URL.
// "Failed to load resource" console lines are not listed on their own: for a file outside the site they are the
// expected result of fixtures.js blocking it, and for a file of our own the same failure is already listed
// from `problems.firstParty` with its status.
//   allow.pageErrors / allow.console: regular expressions for a known, tracked problem on this route
//   allow.firstParty: regular expressions matched against "<status> <path>" (status 0 for a dropped request)
function routeProblems(problems, route, allow = {}) {
  const matches = (list, text) => (list || []).some((re) => re.test(text));
  const where = route.name + ' (' + route.path + ')';
  const lines = [];

  problems.pageErrors.forEach((message) => {
    if (!matches(allow.pageErrors, message)) lines.push(where + ': uncaught page error: ' + message);
  });
  problems.firstParty.forEach((f) => {
    const text = f.status + ' ' + f.url;
    if (!matches(allow.firstParty, text)) {
      lines.push(where + ': own file failed: ' + f.url + ' (' + (f.status ? 'HTTP ' + f.status : f.failure) + ')');
    }
  });
  problems.consoleErrors.forEach((c) => {
    if (/^Failed to load resource/.test(c.text) || matches(allow.console, c.text)) return;
    lines.push(where + ': console error: ' + c.text + (c.url ? ' [' + c.url.replace(/\?.*$/, '') + ']' : ''));
  });
  return lines;
}

// Open the route, then fail with every problem listed together, so one run shows the whole picture.
async function expectCleanRoute(page, problems, route, allow) {
  await openRoute(page, route);
  expect(routeProblems(problems, route, allow), 'problems found on ' + route.name).toEqual([]);
}

module.exports = { useGeolocation, openHome, signUp, storedJson, relief, SMOKE_ROUTES, openRoute, routeProblems, expectCleanRoute };
