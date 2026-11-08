# Accessibility checks (Issue #51)

What was checked, how to repeat it, and what has not been checked yet.

## Run the automated checks

```bash
npm ci
npm test                                   # unit tests, includes tests/accessibility-core-flows.test.js
npx playwright test e2e/accessibility.spec.js
```

`e2e/accessibility.spec.js` runs axe-core (WCAG 2.0 and 2.1, levels A and AA) on 18 pages and fails on any violation. It also checks the keyboard behaviour axe cannot see: where focus goes after the skip link, in the tour dialog, after a refused login, a reminder action and a symptom checker step.

Pages covered: home, login, signup, hospitals, pharmacies, doctors, ambulances, appointments, symptoms, first aid, dashboard, subscription, contact, about, blog and the three legal pages.

## What the fixes were for

| Flow | Problem found | Fix |
|---|---|---|
| Skip link (every page) | `main.js` called `preventDefault()` on every `#` link, so the skip link only scrolled and focus stayed on the link. The same handler read an undefined `navLinks` and threw. | The skip link is left to the browser, and every `<main>` has `tabindex="-1"` so focus lands in it. |
| First-visit tour | `aria-modal` but no focus trap: Tab went to the page behind. After Escape focus fell to `<body>`. | Tab and Shift+Tab wrap inside the dialog, the rest of the page is `inert` while it is open, focus returns to the opener (or to `main` after an automatic open). The step dots are plain buttons with `aria-current="step"` instead of a `tablist` with no panels. |
| Login and signup | Error messages had no live region role, vanished after 5 seconds, fields were not marked invalid, no `autocomplete`, no `h1`, a 20% blue shadow was the only focus cue. | `role="alert"` messages that stay until the person edits a field, `aria-invalid` plus `aria-describedby`, focus moves to the field the message is about, `autocomplete` values, an `h1`, a solid focus outline. |
| Medicine reminders | Pause, Resume, Done and Remove rebuilt the list, so focus dropped to `<body>`, nothing said what happened, and every row had buttons that all read "Pause". | A polite status line says what happened (field validation is #131's). Focus goes back to the same row. Buttons are named "Pause: Iron". |
| Relief Assistant | The chat window was a bare `aria-live` div that a keyboard user could not scroll. | `role="log"` with a name and `tabindex="0"`. |
| Symptom checker | Pressing Next hid the button that had focus, so focus fell to the top of the page and nothing announced the new step. | Steps are named groups that take focus, indicators carry `aria-current`, the results region takes focus when it is ready. |
| Focus rings | `outline: none` with a faint shadow on the symptom form, contact form, hero search and the `summary` in the sources card. | Solid 3px outlines. |
| Contrast | The brand green, blue and pink failed 4.5:1 with white text (2.5, 3.9 and 2.5). Muted text and some badges also failed. The "Sign Up" button had dark text on blue. | Darker theme tokens in every stylesheet, plus the individual badges, alerts and pills. |
| Names | Three links had an `aria-label` that did not contain their visible text. A first aid search button had attribute text leaking into its content. | Labels contain the visible words, the stray text is gone. |
| Structure | Legal pages and four placeholder pages had no `<main>` or `lang`. `pages/home.html` was an empty file that the footers link to. | Added, and `home.html` now sends people to the home page. |

## Manual screen reader checks

**Not done with a real screen reader.** No NVDA, JAWS, VoiceOver or TalkBack pass has been made. What was done instead:

- Keyboard-only traversal in Chromium of every page above (Tab and Shift+Tab through every stop, checking that each one has a visible focus indicator, a name and a sensible order).
- Reading the browser accessibility tree for the changed flows (Playwright `ariaSnapshot`), for example the login page after a refused sign-in shows `textbox "Password" [invalid]` and `alert: Invalid email or password.`, and a reminder row shows `button "Pause: Iron"`.

A person with a screen reader should still run this list, and add the result to this file:

1. Home page: first Tab stops. Use the skip link. Does the reader say you are in the main area and read the next element?
2. First visit: does the tour dialog announce its title and description, and can you reach every control and close it with Escape without hearing the page behind?
3. Login with a wrong password: is the message read out without moving there by hand? Is the password field announced as invalid?
4. Dashboard: add a reminder, pause it, mark it done, remove it. Is each result read out and is focus where you expect?
5. Dashboard assistant: send a message. Is the reply read out once?
6. Hospitals: change a filter. Is the result count read out?
7. Symptom checker: press Next and View Guidance. Is the new step or the results region announced?
8. SOS dialog on the ambulances page: open it, close it with Escape, check that focus returns to the button.

## Known gaps

- Heading levels skip in places (an `h3` follows the `h1` on the hospitals, doctors, symptoms and first aid pages, and the footer headings). axe reports these as best practice, not as WCAG failures, and fixing them means changing styled tags across many pages.
- Some content sits outside a landmark: the Emergency SOS button, the quote above the navigation and the language switch (axe `region`, best practice).
- Only Chromium was used. Firefox and Safari were not tried.
- Text size and zoom (200% and 400%) and Windows high contrast mode were not tested.
- Colours were checked on the pages listed above and in the theme tokens. Text drawn on photographs or gradients is not measured by axe.
- `pages/admin-panel.html` and `pages/how-it-works.html` have no skip link.
- Pages are still English only for the new messages (no `data-i18n` keys yet).
