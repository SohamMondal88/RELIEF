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
  // pages/index.html also loads one testimonial photo from www.amity.edu, which redirects to another host and is not in
  // the Content Security Policy on purpose (docs/SECURITY_HEADERS.md, "One refused image"). The browser logs the refusal.
  home: {
    console: [/^Loading the image 'https:\/\/www\.amity\.edu\//]
  },
  // assets/js/ambulances.js calls Leaflet (L) without checking that the CDN script loaded, so with the CDN
  // blocked the page throws "L is not defined". The same bug is tracked by test.fixme in sos.spec.js.
  ambulances: { pageErrors: [/^L is not defined$/] },
  // Same Leaflet call as ambulances above.
  pharmacies: { pageErrors: [/^L is not defined$/] }
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
    expect(routeProblems(problems, route, KNOWN.home)).toEqual([]);   // the tracked home problems are the only ones left
  });

  test('an allow-listed known problem is skipped, anything else is not', async ({ page, problems }) => {
    await page.addInitScript(() => setTimeout(() => { throw new Error('known bug'); }, 0));
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    expect(routeProblems(problems, route, { ...KNOWN.home, pageErrors: [/^known bug$/] })).toEqual([]);
    expect(routeProblems(problems, route, KNOWN.home)).toHaveLength(1);
    problems.pageErrors.length = 0; // handled here, so the fixture does not fail the test for it
  });
});
