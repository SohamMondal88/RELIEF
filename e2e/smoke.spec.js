// Smoke test: every public route opens with no uncaught error, no console error and no broken file of its own.
// Failures name the route and the URL, for example:
//   ambulances (/pages/ambulances.html): own file failed: /assets/js/missing.js (HTTP 404)
// Anything that would leave the site is blocked by fixtures.js, so the result does not depend on a CDN,
// map tiles or the network being up. See docs/E2E_TESTING.md.
const { test, expect } = require('./fixtures');
const { SMOKE_ROUTES, expectCleanRoute, routeProblems } = require('./helpers');

// Files that Vercel serves itself and that are not in the repository (the web analytics script), so a local
// server has nothing to send. They are answered with an empty script to keep the run the same everywhere.
test.beforeEach(async ({ page }) => {
  await page.route('**/_vercel/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
});

// Known problems per route, each tied to a real bug. Remove the entry in the pull request that fixes it.
const KNOWN = {
  // assets/css/style.css line 1120 has url('assets/images/pattern.png'), which resolves to
  // /assets/css/assets/images/pattern.png. There is no pattern.png in assets/images either.
  home: { firstParty: [/^404 \/assets\/css\/assets\/images\/pattern\.png$/] },
  // assets/js/ambulances.js calls Leaflet (L) without checking that the CDN script loaded, so with the CDN
  // blocked the page throws "L is not defined". The same bug is tracked by test.fixme in sos.spec.js.
  ambulances: { pageErrors: [/^L is not defined$/] },
  // assets/js/doctors.js points at ../assets/images/doctor1.jpg to doctor6.jpg, none of which exist in the repository.
  doctors: { firstParty: [/^404 \/assets\/images\/doctor[1-6]\.jpg$/] }
};

test.describe('smoke: public routes open cleanly', () => {
  for (const route of SMOKE_ROUTES) {
    const allow = KNOWN[route.name] || {};
    test.describe(route.name, () => {
      // The page fixture fails any uncaught error, so a known one has to be named there as well.
      test.use({ allowedPageErrors: allow.pageErrors || [] });
      test(route.path, async ({ page, problems }) => {
        await expectCleanRoute(page, problems, route, allow);
      });
    });
  }
});

// These check the checker: a smoke test that cannot fail proves nothing.
test.describe('smoke helper catches real problems', () => {
  const route = { name: 'home', path: '/index.html', ready: '.main-content' };

  test('a missing first-party script is reported with the route and the URL', async ({ page, problems }) => {
    await page.route('**/assets/js/main.js', (r) => r.fulfill({ status: 404, body: 'gone' }));
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    expect(routeProblems(problems, route)).toContainEqual(expect.stringContaining('home (/index.html): own file failed: /assets/js/main.js (HTTP 404)'));
  });

  test('a console error from the page is reported', async ({ page, problems }) => {
    await page.addInitScript(() => setTimeout(() => console.error('boom from test'), 0));
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    expect(routeProblems(problems, route).join('\n')).toContain('console error: boom from test');
  });

  test('blocked outside requests are expected and do not count', async ({ page, problems }) => {
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    expect(problems.blocked.length, 'the home page loads fonts or icons from outside').toBeGreaterThan(0);
    expect(routeProblems(problems, route)).toEqual([]);
  });

  test('an allow-listed known problem is skipped, anything else is not', async ({ page, problems }) => {
    await page.addInitScript(() => setTimeout(() => { throw new Error('known bug'); }, 0));
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    expect(routeProblems(problems, route, { pageErrors: [/^known bug$/] })).toEqual([]);
    expect(routeProblems(problems, route)).toHaveLength(1);
    problems.pageErrors.length = 0; // handled here, so the fixture does not fail the test for it
  });
});
