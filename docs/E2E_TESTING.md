# Browser (end-to-end) tests

These tests drive the real pages in Chromium with [Playwright](https://playwright.dev/) and cover the main RELIEF user journeys (Issue #23). Playwright is the only dev dependency (`@playwright/test` in `package.json`). The site itself still has no build step.

## Run them

```bash
npm ci                            # once
npx playwright install chromium   # once (add --with-deps on a fresh Linux machine)
npm run test:e2e                  # run everything
npx playwright test e2e/sos.spec.js            # one file
npx playwright test -g "reminder"              # tests whose title matches
npx playwright test --headed --workers=1       # watch it run
npm run test:e2e -- --ui                       # Playwright's interactive UI
```

The config (`playwright.config.js`) starts `e2e/static-server.js`, a small Node static server for the repository root on port 4173 (set `E2E_PORT` to change it). To use a server you already run, for example `python3 -m http.server 8000`, set `E2E_BASE_URL`:

```bash
E2E_BASE_URL=http://localhost:8000 npm run test:e2e
```

If Playwright cannot download its browser on your machine, point `RELIEF_CHROMIUM_PATH` at an installed Chromium or Chrome. `npm test` runs the unit tests in `tests/` with `node --test`.

## What is covered

| File | Journey |
|---|---|
| `e2e/navigation.spec.js` | Landing page, primary navigation, hamburger menu on a phone width (open, close, Escape, focus), Relief Assistant on the dashboard (greeting, routing, urgent escalation, medical advice refusal, clear chat) |
| `e2e/auth.spec.js` | Demo signup, validation errors, duplicate email, login (right and wrong password), navbar Dashboard and Logout, logout clears the session, no plain text password in storage |
| `e2e/facility-search.spec.js` | Facility search, area, service and "Verified only" filters, empty state, Save, Directions, manual-location fallback (built-in town, mocked lookup, not found, bad entry, network failure), mocked device location, list load failure with Retry |
| `e2e/sos.spec.js` | SOS dialog (focus, Escape, Tab trap), no backend configured, server error, unconfirmed 200, dropped connection, Retry, confirmed success with a mocked location, denied location, offline, closing while a request is in flight |
| `e2e/reminders.spec.js` | Reminder add, validation and duplicate, edit, pause and resume, done and remove, persistence across reload, due banner with a fixed clock |
| `e2e/firstaid-offline.spec.js` | First aid search and categories, opening a guide, the page working offline after one visit (service worker), account pages not cached |
| `e2e/network-resilience.spec.js` | Bad connections (Issue #102): outside hosts (fonts, icon font, Leaflet) that abort, answer 503 or answer empty, going offline while a page is open, a slow or failing facility list, translation file and place lookup |

## Network helpers

For tests about a bad connection, use the helpers in `e2e/helpers.js` (call them before `page.goto`). Each one that intercepts returns `{ requests }`, the URLs it caught, so a test can assert the failure really happened.

| Helper | What it does |
|---|---|
| `failRequests(page, matcher)` | The request fails at once (dropped connection) |
| `errorResponse(page, matcher, { status })` | The server answers with an error, 503 by default |
| `delayRequests(page, matcher, ms)` | The request waits, then goes to the local server (same-origin only) |
| `holdRequests(page, matcher)` | The request stays pending until `release()` (goes through) or `fail()`. `pending()` says how many are waiting. Use it to look at a loading state without a timer |
| `failThirdParty(page, { baseURL, mode })` | Every outside host fails as `abort`, `error` (503), `empty` (200 with an empty file) or `hang` (never answers) |
| `goOffline(page)` / `goOnline(page)` | Switches the whole browser context offline and back |
| `waitForOfflineCopy(page, path)` | Visits a page online until the service worker controls it and has filled its cache |

`matcher` is anything `page.route` takes: a glob, a RegExp or a function. The helpers never pass a request on to an outside host.

## Rules the tests follow

- **No real emergency actions.** `e2e/fixtures.js` replaces `window.open`, records and cancels clicks on `tel:` and `sms:` links, and makes geolocation "denied" unless a test opts in with `useGeolocation()`. The SOS endpoint in the tests is a fake host (`sos.mock.relief.test`) answered by `page.route`.
- **No real network.** Every request that leaves the local site (fonts, icons, map tiles, Leaflet, Nominatim) is blocked. Tests that need an answer from one of them mock it.
- **Clean state.** Every test gets a fresh browser context, so localStorage starts empty.
- **Uncaught page errors fail the test**, unless a spec lists the error in `allowedPageErrors` next to a comment about the bug.
- Reduced motion is switched on, because the sign-up form floats forever and Playwright otherwise waits for it to "settle" before clicking.

## When a test fails

On failure Playwright keeps, under `test-results/` (CI uploads it as the `playwright-report` artifact for 7 days):

- a **trace** (`trace.zip`) with every step, DOM snapshot, console and network call: `npx playwright show-trace test-results/<test>/trace.zip`
- a screenshot (`test-failed-1.png`) and `error-context.md`

The browser console output, the list of blocked outside requests and the recorded emergency actions (`console.txt`, `blocked-external-requests.txt`, `emergency-actions.json`) are attached to the failing test in the HTML report in `playwright-report/` (`npx playwright show-report`) and printed under the error in the terminal.

## Known gaps tracked as `test.fixme`

These are real behaviours the tests found. They are skipped, listed in the report as skipped, and each should be un-skipped by the change that fixes it.

| Test | What is wrong |
|---|---|
| `auth.spec.js` signed-out visitor opens the dashboard | `pages/dashboard.html` has no sign-in check, so there is no protected page to test yet |
| `navigation.spec.js` Services menu at 1280px | The logo image covers the Services link (logo x 555 to 725, link x 548 to 669), so the mouse cannot reach the menu |
| `navigation.spec.js` no horizontal scrolling at 375px | The language switcher sticks out 2px past the viewport |
| `sos.spec.js` ambulances page without page errors | `ambulances.js` calls Leaflet (`L`) when the CDN script did not load and throws "L is not defined" |
| `network-resilience.spec.js` first aid is readable while an outside stylesheet is still pending | A stylesheet in `<head>` that never answers (Font Awesome) stops the parser, so not even the `<h1>` is in the page until the browser gives up |
| `network-resilience.spec.js` facility list gives up waiting | `fetch()` in `hospitals.js` has no timeout, so "Loading facilities..." stays for ever when the server never answers |
| `network-resilience.spec.js` place lookup gives up waiting | Same in `location-service.js`: "Looking up that place..." for ever |
| `network-resilience.spec.js` hospitals page opens offline | `sw.js` precaches `hospitals.html` but not `facility-utils.js`, `location-service.js`, `location-panel.js`, `i18n.js` and other scripts it needs, so offline the page has no list and no message |
| `sos.spec.js` focus returns to the SOS button | A click opens the SOS dialog twice (button handler plus document handler), so focus is lost on close |

Not covered because the feature does not exist yet: a Relief Assistant launcher that opens and closes (the assistant is a card on the dashboard).

## CI

`.github/workflows/ci.yml` has an `e2e` job (`Browser tests (Playwright)`) next to the existing checks, and the old "tests skipped" step now runs `node --test`. A failing job fails the pull request check. To make it block merging, a maintainer has to mark **Browser tests (Playwright)** and **Lint, Syntax & Link Checks** as required status checks in the repository's branch protection settings (not something a pull request can change).

## Adding a test

Import from `./fixtures` (not `@playwright/test`) so the guards above apply, prefer roles and labels (`getByRole`, `getByLabel`) over CSS selectors, and mock anything that would leave the site with `page.route`. Never click a `tel:` or `sms:` link to see what happens: assert its `href`.
