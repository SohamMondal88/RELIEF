# Shared header and footer (Issue #104)

Every public page has the same header and footer, written from one set of templates in `layout/` by a small script. There is still no build step and no framework: the pages stay plain HTML files that you can open and read, and a unit test fails when a page drifts away from the templates.

## Change the header or footer

1. Edit the template in `layout/` (plain HTML, one file per part and kind of page).
2. Run `node scripts/shared-layout.js`. It rewrites the part between the two marker comments on every page.
3. Commit the templates and the pages together. `node scripts/shared-layout.js --check` changes nothing and exits 1 when a page is out of date. `node --test tests/shared-layout.test.js` runs the same check, so CI catches a hand edit.

Never edit between `<!-- shared-layout:header begin ... -->` and `<!-- shared-layout:header end -->` (or the footer and head ones) by hand. The next run of the script puts the template back.

| Template | Used by | Content |
|---|---|---|
| `layout/site-header.tpl`, `layout/site-footer.tpl` | the "site" pages: `index.html`, `login`, `signup` and the pages with a directory or an article (`about`, `ambulances`, `appointments`, `blog`, `contact`, `doctors`, `firstaid`, `hospitals`, `pharmacies`, `symptoms`) | The logo, menu with the Services group, Emergency link, Login and Sign Up, and the full footer |
| `layout/compact-header.tpl`, `layout/compact-footer.tpl` | the "compact" pages built on `professional-pages.css`: `admin-panel`, `careers`, `dashboard`, `donate`, `health-events`, `how-it-works`, `press`, `privacy`, `subscription`, `team`, `volunteer` | A skip link, a one-line top bar with the same destinations and the Emergency link, and a small footer with the medical disclaimer and legal links |
| `layout/head.tpl` | all of them | One line: the `<link>` to `assets/css/shared-layout.css` |

Template tokens: `{{root}}` is the way back to the site root (`""` on `index.html`, `"../"` in `pages/`), so the same template gives valid links at both depths. `{{if:tour}} ... {{endif}}` keeps a block only on the page that has the first-visit tour (`index.html`). The link to the page being shown gets `aria-current="page"` automatically.

To add a page, put it in `SITE_PAGES` or `COMPACT_PAGES` at the top of `scripts/shared-layout.js` and run the script: a page with no markers yet has its old header or footer (or none) replaced by the template the first time. Keep a note that belongs to one page (for example a page's own disclaimer) outside the markers, as a `<p class="page-note">` inside `<main>`.

## Why a generator and not a script include

The pages work without JavaScript, they are read by search engines and screen readers as they are, the header does not flash in after load, and the service worker has nothing extra to save. A JavaScript include would have to fetch the markup, run before `i18n.js` and `main.js` wire the menu and the language, and would show no header at all when it fails. Plain files plus a checked generator keep the architecture as it was and remove the drift, which is what was wrong.

## What the audit found (before)

| | |
|---|---|
| Header markup | 12 different versions on the 23 public pages that had a header. Ten pages shared one menu, the home page had another (with the Tour button and Health camps), `login` and `signup` had a menu of one link and one button each, `404.html` four links, five pages had a one-line top bar with three to four different link sets, and `accessibility.html` two links. Eight pages had no header at all |
| Footer markup | 6 versions. A full footer on the home page and on ten pages (without Health camps on the ten), a shorter one with other contact details on `login` and `signup`, a small own footer on `accessibility`, a single line of text on nine pages (the line was sometimes a medical disclaimer or an event notice), none on eight. "Home" in the full footer pointed at `pages/home.html`, a redirect stub |
| Emergency access | The floating Emergency SOS button (`app-enhancements.js`) was missing on `404`, `accessibility`, `donate`, `privacy`, `volunteer`. The menu reached the ambulances page only through the Services group, which is closed in the phone menu, and not at all from `login`, `signup`, `subscription`, `health-events` and others |
| Current page | Only `health-events.html` marked its page (`aria-current`) |
| Phone menu | The closed menu was off screen but still in the tab order, so Tab went to invisible links. The two link lists stacked on top of each other and hid each other, the hamburger lines had no height on most pages, and the menu started below the width where the header already wrapped and hid links under the logo (between 993 and 1279px) |
| Paths | Mixed `../pages/x`, `./x`, `x` and `/x`. They resolved, but one wrong depth would not have been noticed. `404.html` needs root-absolute paths because it is served from any URL depth, and it has them |

## What a page has now

- **Emergency access without sign-in or location.** A red "Emergency" link in every header goes to `pages/ambulances.html`. On the phone it is the first item of the account part of the menu, and the floating Emergency SOS button is still there. The ambulances page needs neither. The compact pages show the link in the bar itself with no menu to open.
- **Current page.** The link to the page you are on has `aria-current="page"` and is underlined and blue, so it is not shown by colour alone. Inside Services, the entry and the Services toggle are marked.
- **Phone menu with the keyboard.** At 1279px and below the menu collapses into a 44px hamburger button (`aria-expanded`, `aria-controls`). Closed, the menu is `visibility: hidden`, so it is out of the tab order and not read out. Opening it moves focus to its first link, Tab walks it in order (page links, then Emergency, Login, Sign Up) and ends on the button, Escape closes it and puts focus back on the button, and tapping a link closes it. Upright it is one panel from the right with the account links at the bottom clear of the SOS button; held sideways it is two columns so nothing is cut off.
- **Valid nested paths.** Templates only ever contain `{{root}}`-prefixed paths, so a page in `pages/` and the home page both link correctly, and the unit test follows every header and footer link from every page to a file that exists.
- **A skip link and one `main` target** on every page that uses the shared parts.

## Pages that keep their own markup, and why

| Page | Reason |
|---|---|
| `404.html` | Self-contained and JavaScript free, because it is served from any URL depth. It uses root-absolute paths and has its own Emergency button |
| `pages/offline.html` | The offline fallback has to work with nothing else saved, and shows the emergency numbers itself |
| `pages/home.html` | A redirect stub with no content |
| `pages/accessibility.html`, `cookie-policy`, `privacy-policy`, `terms-of-service` | Legal text with inline styles and no site chrome. Each still loads the Emergency SOS button or links to the ambulances page, and a test checks that |
| `profiles/*` | Role dashboards with their own layout and demo data, not part of the public site |

`tests/shared-layout.test.js` fails when a page not on these lists carries its own `<nav class="navbar">`, `<header class="topbar">` or footer.

## Limits

- The stylesheets of the "site" pages are separate copies. `assets/css/shared-layout.css` loads last and settles the parts that matter here (the Emergency link, the current mark, the menu), but the colours and spacing of the rest of the header still come from each page's own CSS.
- The site pages hide everything until `main.js` shows it (an older rule on the page itself), so without JavaScript only the compact pages show anything. The links in the shared parts are plain links either way.
- `RELIEF_MOBILE_NAV_MAX` in `assets/js/main.js` and the `1279px` in `shared-layout.css` must stay equal. A test checks it.
- Chromium only. No real screen reader was used: the checks read roles, names, `aria-*` attributes, tab order and focus.

## Tests

- `node --test tests/shared-layout.test.js` checks every page against the templates (drift, no second copy, tokens, paths, the Emergency link, `aria-current`, skip link, landmark names, the phone menu rules, the script and the stylesheet agreeing on the breakpoint, the offline copy of the stylesheet).
- `npx playwright test e2e/shared-layout.spec.js` checks it in a browser: the Emergency link on all 24 pages at 375px, signed out, with the floating button; the phone menu with the keyboard (tab order, focus on open, Escape, nothing off screen, upright and sideways); every header link reachable by mouse at 1280 and 1440px; the current-page mark; links that answer 200 from three folder depths; the 404 page; the skip link; and the compact pages without JavaScript.
