# Deployment audit (Issue #66)

Why changes in the repository did not show, or did not work, on the Vercel site, what was found, what was fixed and what only the Vercel project owner can check. Written on 9 November 2026 against `main` at `593de3d`.

> RELIEF is a demonstration project. Nothing here makes it safe for real patients or emergencies.

## 1. What the project is

| Question | Answer, and how it was established |
|---|---|
| Framework | None. Plain HTML, CSS and JavaScript files. `package.json` says "there is no build step" and holds only test scripts. |
| Build command and output | None. Vercel copies the repository root. `vercel.json` has no `buildCommand` or `outputDirectory`. |
| Runtime code on Vercel | None. No `api/` folder, no serverless function. `@vercel/analytics` is loaded as a browser script (`assets/js/vercel-analytics.js`). |
| Production URL | `https://relief-gamma.vercel.app` (README and `deploy-smoke-check.js`). |
| Environment variables | None are read at build time. Browser code reads optional globals that a deployer may set (`window.RELIEF_BACKEND_URL`, `window.RELIEF_SOS_ENDPOINT`). Nothing sets them, so the live site runs in demo mode. |

## 2. Is the live site behind `main`? No, it matches it

Every first-party `.html`, `.js`, `.css`, `.json` and `.webmanifest` file in the repository (107 files) was fetched from the live site (clean URLs, redirects followed) and compared with the file at `593de3d`, ignoring line endings. 103 were identical on the first pass. The other four were one request that timed out and three comparisons spoiled by trailing newlines in the comparing script. Compared again by hand, all three matched. `vercel.json` is not served, as expected. The live `sw.js` is `CACHE_VERSION = 'v5'`, the same as `main`.

So on 9 November the production alias was serving the latest `main`. It was not stale. That rules out "changes never reach the deployed commit" as the cause today. It does not say what happened to earlier deployments, which only the Vercel dashboard shows (section 7).

## 3. What was actually wrong

These were found by running the checks the repository already has, then tracing each failure to the commit that caused it. `main` had a red CI run for each of the last eight merges (`gh run list`). Most failures were two pull requests that each changed the same file and did not know about each other, so the merge kept one side.

| # | Problem | Evidence | Cause | Fixed in |
|---|---|---|---|---|
| 1 | **The security headers are not sent.** The live response has no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`, although `docs/SECURITY_HEADERS.md` says `vercel.json` sends them. `tests/security-headers.test.js` crashed on `vercel.json` at load. | `curl -I` of the live site. The test run. | Commit `70b9a8b` (404 page) replaced `vercel.json` with `cleanUrls` plus a legacy `routes` list and dropped the `headers` block added in `8ec47f8`. | `vercel.json` |
| 2 | **`routes` and `headers` do not mix.** | `@vercel/routing-utils` 6.6.1 (the library Vercel uses to read `vercel.json`) turns `routes` plus `headers` into one list where the header rule comes after `{"handle": "filesystem"}` and after the catch-all to `/404.html`. A rule after the filesystem step is not reached for a file that exists. Run in a scratch folder, not on Vercel. | So re-adding `headers` next to the old `routes` would have done nothing. | `vercel.json` has no `routes` now. `tests/vercel-config.test.js` keeps it that way. |
| 3 | **`assets/js/reminders.js` throws when it loads.** `ReferenceError: localEquivalent is not defined`, so `window.ReliefReminders` is never set. The dashboard reminders and four test files fail. | `node --test`. | The merge of PR #138 (`56e8e73`) dropped `localEquivalent` and `explainSchedule`, and the merge of PR #144 (`de1b007`) dropped two saved fields (`scheduleMode`, `lastNotifiedAtMs`), all from the time-zone work in PR #132 (`f092c1c`). The export list still named them. | `assets/js/reminders.js`, restored unchanged from `1957c91` |
| 4 | **Inline script blocked by the policy.** `pages/health-events.html` had an inline `<script>`; with the policy restored the date inputs would stop updating the form. | `tests/security-headers.test.js`. | The page was written before the policy existed. | Moved to `assets/js/health-events-dates.js`, same code. |
| 5 | **Five pages had no CSP meta tag** (`accessibility`, `health-events`, `home`, `offline`, `404`). | `tests/security-headers.test.js`. | Added after the policy by other pull requests. | The same tag as every other page. |
| 6 | **The 404 page loses its styles on a nested path.** It linked `assets/css/style.css`; for `/a/b/c` that is `/a/b/assets/css/style.css`. | Reading the file. | Relative links in a page that Vercel serves for any missing path. | Root-absolute links. |
| 7 | **Offline copy missing a script.** `hospitals.html` loads `storage-schema.js`, which `sw.js` did not save, so the page breaks offline. | `tests/pwa.test.js`. | Script added after the list was written. | Added to `sw.js`, `CACHE_VERSION` raised to `v6` as the file asks. |
| 8 | **Raw attribute text in the First Aid search button** (` data-i18n-attr="aria-label:firstaid.search.button"` shown inside the button). | `tests/accessibility-core-flows.test.js`. | Attribute pasted outside its tag in a merge. | Moved inside the tag. |
| 9 | **Admin page lost two features.** The facility freshness list (`c341731`) and the health event moderation queue (`fcdb198`) were gone, because later pull requests replaced the whole file. | `tests/facility-review.test.js`, `tests/health-events.test.js`. | Same: whole-file replacement. | Both sections and their scripts restored from those commits. |
| 10 | **Privacy inventory missing three storage keys** (`relief_demo_health_events`, `relief_health_event_submissions`, `relief_onboarding_status`). | `tests/privacy-data.test.js`. | Dropped in merges. | Entries and `docs/PRIVACY_AND_DATA.md` rows restored. |
| 11 | **Health event forms sent no method.** A GET submit would put the event's contact details in the address bar if the script failed to load. | `tests/url-log-hygiene.test.js`. | Missing attribute. | `method="post"`. |
| 12 | Three pages had no `lang`, one `<main>` had no `tabindex="-1"` (skip link). | `tests/accessibility-core-flows.test.js`. | Pages added after the accessibility pass. | Attributes added. |
| 13 | **"Back to top" could not be clicked.** The Emergency SOS button (`app-enhancements.js`, `z-index: 9999`) sat exactly on top of it (`main.js`, `z-index: 1000`, same corner). Playwright: "Emergency SOS intercepts pointer events". | `e2e/reduced-motion.spec.js` after it was pointed at that button. | Two scripts each put a fixed button in the bottom right corner. | Back to top moved up to `bottom: 5.5rem`. |
| 14 | The reduced-motion scroll in `main.js` used `behavior: 'auto'` where the reduced-motion work (`d066e9f`) set `'instant'`. With `scroll-behavior: smooth` in the css, `'auto'` still animates. | Diff against `d066e9f`. | A merge kept the older line. | `'instant'`, through the same helper as the other scrolls. |
| 15 | A link inside a sentence on the appointments page was only told apart by colour (contrast 1.09:1 with the text around it). | axe-core, `link-in-text-block`. Hidden until now because axe could not run (see the e2e note below). | No underline. | `text-decoration: underline`. |
| 16 | **The browser test helpers were damaged by merges.** `e2e/helpers.js` no longer exported `showTour`, `openRoute`, `routeProblems` or `expectCleanRoute`, so 16 browser tests died with "is not a function" before testing anything. | Playwright run. | Merges `d3a7f8b`, `dadbbed` and `2975452`. | The functions are back, from the commits that added them. |

Test-side changes that follow from the above, so they are listed and not hidden:

- `tests/facility-utils.test.js`: the shared fixture marked a record verified without a verifier. The verification policy (`docs/FACILITY_VERIFICATION_POLICY.md`) needs a source, a verifier and a past date, so the fixture now has a verifier and a fixed clock.
- `tests/privacy-data.test.js`: a name ending in `_` is a prefix (`form-guard.js` writes `relief_formguard_<form>`). It counts as covered when a listed key starts with it. Every real key still has to be listed.
- `tests/url-log-hygiene.test.js`: the one `console.warn` in `request-resilience.js` is allowed, with its own test that the entry is made from fixed fields and `redact()`.
- `tests/admin-panel.test.js`: "every button outside the working section is disabled" now names the three working sections.
- Browser tests, each a test that no longer matched the code after other pull requests:
  - `e2e/accessibility.spec.js`: axe-core is injected as inline script, which the site's policy blocks, so no axe check could run. The policy is bypassed for that block only.
  - `e2e/contact.spec.js`: the fake backend (`backend.mock.relief.test`) is not in `connect-src`, so the browser refused the call before the test could answer it. Bypassed for that file only. A real deployment adds its backend to the policy (`docs/SECURITY_HEADERS.md`).
  - `e2e/admin-panel.spec.js`: "no Refresh button" now looks inside the corrections card, because the page also has the read-only freshness list and the event queue.
  - `e2e/network-resilience.spec.js`: `.loading-state` and `.error-state` became `.state-loading` and `.state-error` (`request-resilience.js` draws them), and a 503 is retried 3 times and worded by the classifier.
  - `e2e/reminders.spec.js`: `#reminder-errors` is `#reminder-error-summary` since the validation summary work.
  - `e2e/reduced-motion.spec.js`: the skip link is native now, so the scroll check uses Back to top.
  - `e2e/pwa.spec.js`: Chromium restarts the idle service worker and the new one is not offline. Offline is switched on again before each navigation.
  - `e2e/smoke.spec.js`: the route list grew to 11 pages (`2975452`) and found files that are missing from the repository. They are named in `KNOWN` with the reason, see section 6.
- `.github/scripts/deploy-smoke-check.js`: now also fails when a page comes back without the security headers (see section 5).

## 4. Results

| Check | `main` at `593de3d` | This change |
|---|---|---|
| `node --test` with Linux line endings (as in CI) | 1051 ran, 22 failed, and 6 test files crashed on load so their tests did not run (CI shows the same files failing) | 1250 tests, all pass |
| Browser tests, `npm run test:e2e` | CI: 64 failed, 81 passed, 7 skipped | 138 passed, 7 skipped, 7 failed on my Windows machine. The 7 are the contact form tests, which fail at ticking the consent box in this machine's Chromium (`check()` reports no change); the same 7 fail on an untouched checkout of `main` here, while CI on `main` failed 4 of those 8 (the ones that use the fake backend) and passed the other 4. With the box ticked by script and the CSP change above, all 8 pass. They have not been run on Linux. |
| JavaScript syntax check and HTML reference check (the two first CI steps) | pass | pass |
| `node .github/scripts/deploy-smoke-check.js --env production` | 68 of 68 answered, headers not checked | 68 of 68 answered; the new header check fails on the live site until this is deployed |

## 5. How to verify a deployment from now on

1. **Right commit.** The site has no version file. Compare the served files with the commit: for each tracked `.html`, `.js`, `.css`, `.json` and `.webmanifest` file, fetch it from the URL (for pages use the clean URL, `/pages/firstaid` not `/pages/firstaid.html`) and compare it with the file at the commit, ignoring line endings. All equal means that commit is what is live. Section 2 is that check.
2. **Files and headers.** `npm run smoke:deploy -- --env production` (or `--env preview --url <preview url>`). It now fails if a page lacks the CSP with `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY` or the referrer policy.
3. **Behaviour.** The manual list in `docs/DEPLOY_SMOKE_CHECK.md`.

## 6. Found and not fixed

- **Missing image files, also missing on the live site** (404 checked with `curl`): `assets/images/pharmacy1.jpg` to `pharmacy6.jpg`, `assets/images/cta-bg.jpg`, `dots-pattern.png`, `dots-pattern-white.png`, `wave-divider-dark.svg`, `assets/css/images/contact-hero.jpg`, `wave-pattern.png`, `form-pattern.svg`, `dots-pattern.svg`, and `assets/css/assets/images/pattern.png` (a wrong relative path in `style.css`). Fixing them needs the artwork or a decision to drop the decoration. They are listed in `e2e/smoke.spec.js` (`KNOWN`) so the smoke test can stay on and still catches anything new.
- **One refused image on the home page** (`www.amity.edu` photo). Documented in `docs/SECURITY_HEADERS.md` as an accepted exception; also in `KNOWN`.
- **`pharmacies.js` and `ambulances.js` call Leaflet (`L`) without checking that it loaded.** On the live site the script comes from unpkg, so this only shows when that CDN is blocked.
- **No Vercel-side checks** (next section).

## 7. What this audit could not check

No Vercel account was available, so these are **not verified** and need the project owner:

- That the project's **Production Branch** is `main` and its **Root Directory** is the repository root (not a sub-folder).
- That **Framework Preset** is "Other", with no build command and no output directory override, and that **Ignored Build Step** is not skipping builds.
- The **deployment list**: whether any recent production deployment ended in `Error` or `Canceled`, and which commit the production alias points at. Only the dashboard shows this, and it is the only way to explain why changes were missing earlier in the week.
- That `vercel.json` is accepted by Vercel as written now. The format is the one used before `70b9a8b`, and the routing library accepts it (section 3, row 2), but no deployment of it was made.
- That an unknown path still answers with the 404 page and a 404 status without the old catch-all. Vercel serves `404.html` for static sites by itself; a preview deployment of this change shows it. Before: `curl -s -o /dev/null -w '%{http_code}' https://relief-gamma.vercel.app/nope` printed `404`.
- Build and function logs, and environment variables. There are none to read for the build, and the runtime has no function.

After this is merged and deployed, run the three steps in section 5 on the production URL and attach the output to this issue.
