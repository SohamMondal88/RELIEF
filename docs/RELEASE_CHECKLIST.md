# Release checklist for healthcare content and UI changes

Use this when you open a pull request that changes what a visitor reads, sees or can do on a RELIEF page, and again when a maintainer reviews it. It is a reviewer aid, not a replacement for the setup steps in [CONTRIBUTING_SETUP.md](CONTRIBUTING_SETUP.md) or the contribution rules in the README.

Copy the sections that apply into your pull request description and tick only what you really checked. Write "n/a" with a short reason for a section your change does not touch, and say plainly what you could not test. Pure refactors and tooling changes can skip sections 2, 5 and 6.

> RELIEF is a demonstration project. A green checklist does not make a page safe for real patients or real emergencies.

## 1. Emergency access

- [ ] SOS, the emergency call links (`tel:`), first aid and the ambulances page still work with **no sign-in and no location permission**.
- [ ] Nothing new sits in front of an emergency action (login wall, consent popup, onboarding step, slow script).
- [ ] When location is denied or unavailable the page says so and still offers a way forward (phone number, typed place).
- [ ] The page never says help was sent or booked unless a server confirmed it.
- [ ] If you touched the SOS flow, `npx playwright test e2e/sos.spec.js` passes.

## 2. Source and provenance of health content

- [ ] New facility, doctor, pharmacy, ambulance or first aid information names where it came from, or is clearly labelled as sample data.
- [ ] Nothing is shown as **Verified** without a source and a check date (see [FACILITY_DATA_CONTRACT.md](FACILITY_DATA_CONTRACT.md)).
- [ ] No invented hospitals, doctors, phone numbers or opening hours. Placeholder data uses obviously fake values such as `5550` numbers and `example.org` links.
- [ ] Guidance text keeps to the rules in [MEDICALLY_CAUTIOUS_GUIDANCE.md](MEDICALLY_CAUTIOUS_GUIDANCE.md): no diagnosis, no medicine names or doses as advice, a clear "call emergency services" path.
- [ ] Anything that needs a clinician's review is called out in the pull request instead of being presented as reviewed.

## 3. Accessibility

- [ ] Everything can be used with the keyboard only, in a sensible tab order, with a visible focus indicator.
- [ ] Form fields have labels, errors are announced and tied to their field, and icon-only buttons have an accessible name.
- [ ] Dialogs trap focus, close with Escape and return focus to the control that opened them.
- [ ] Colour is not the only way a status is shown (for example "Not verified" is also written out).
- [ ] Animations respect `prefers-reduced-motion`.
- [ ] `node --test tests/accessibility-audit.test.js` passes.

## 4. Privacy and stored data

- [ ] No personal or health data goes into a URL, a log line or a third-party request.
- [ ] Every new `localStorage` or `sessionStorage` key is added to the inventory in `assets/js/privacy-data.js` and to [PRIVACY_AND_DATA.md](PRIVACY_AND_DATA.md). `tests/privacy-data.test.js` fails if one is missing.
- [ ] No new cookie, tracker, analytics call or external script without a note in the pull request.
- [ ] No real patient data, keys, passwords or tokens in code, fixtures, screenshots or the pull request text.

## 5. Language support

- [ ] New visible text is marked with `data-i18n` (or `ReliefI18n.t`) and exists in both `assets/locales/en.json` and `assets/locales/bn.json`, as described in [TRANSLATING.md](TRANSLATING.md).
- [ ] The page still reads correctly when a key is missing (fallback is English, then the HTML text).
- [ ] `node --test tests/i18n.test.js` passes.
- [ ] Emergency and safety wording was not machine-translated without someone who reads Bengali checking it. If nobody did, say so in the pull request.

## 6. Responsive behavior

- [ ] Checked at a phone width (about 375px), a tablet width and a desktop width.
- [ ] No horizontal scrolling, no overlapping or clipped buttons, and emergency buttons are not covered by other floating elements.
- [ ] Touch targets are big enough to hit with a thumb.
- [ ] Screenshots of the changed pages are in the pull request.

## 7. Tests

- [ ] `npm test` was run and the result is in the pull request. Failures that also happen on a clean `main` are listed as such.
- [ ] `npm run test:e2e` was run if the change touches a page covered by `e2e/` (see [E2E_TESTING.md](E2E_TESTING.md)).
- [ ] New behavior has a test, or the pull request explains why it cannot have one.
- [ ] CI is green, or the red checks are explained.
- [ ] Tests do not call real services, dial, SMS or ask for real browser permissions.

## 8. Demo versus live wording

- [ ] Copy does not claim a feature is live, verified, 24/7 or connected to a real provider unless it is (see section 6 of [CONTRIBUTING_SETUP.md](CONTRIBUTING_SETUP.md)).
- [ ] Mock and sample data is labelled as such on the page, not only in the code.
- [ ] A button that only changes this browser's `localStorage` does not read as if a clinic, pharmacy or ambulance received something.

## 9. Before and after deployment

- [ ] The pull request names any config, service or setting that has to change at deployment, or says "none".
- [ ] New files are in the right place and every `href`/`src` resolves (`python .github/scripts/check-links.py`).
- [ ] If `sw.js` caches something that changed, `CACHE_VERSION` was bumped.
- [ ] After the change is deployed, someone opens the live URL and checks the home page, SOS, hospitals, first aid and the page that was changed, and records the URL and what they saw. Do not paste secrets or tokens into that note.
- [ ] A successful build or deploy is not counted as a live check. Only a check of the deployed site is.

## Reviewer quick pass

If you only have five minutes: sections 1, 2 and 8 first. A change that hides an emergency action, shows unsourced information as verified, or overstates what the demo does should not be merged, even if everything else is green.
