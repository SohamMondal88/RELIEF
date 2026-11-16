# RELIEF design system (issue #130, first slice)

A calmer, more consistent look for RELIEF, built as one token file and one component layer that pages opt into. This is the **first slice** of the redesign in issue #130, not the whole of it. [What is and is not covered](#coverage) lists every page.

## Direction

RELIEF is used by people who may be worried, in a hurry or on a poor phone connection. The old theme worked against that: a blue-grey gradient behind everything, a 170 px logo hanging over the page heading, three competing accent colours, white text that turned invisible on hover, and a different copy of the same CSS variables in each page stylesheet.

The new direction:

- **Quiet and clinical.** Off-white page, white cards with a thin border and a soft shadow, one green for brand and primary actions.
- **Red is for emergencies only.** SOS and emergency buttons are the only filled red on the site, so it keeps its meaning. Error text uses a dark red on a pale red panel and never fills a button.
- **Readable first.** Body text is 13:1 on the page, secondary text 6.9:1 or better, and every colour pair below is measured, not guessed.
- **Nothing in the way of an emergency.** The header is a 64 px bar (the old one reserved room for a 170 px logo that hung over the heading), SOS and `tel:` links are untouched, and the layer adds no scripts and no new origins.
- **Little motion.** Only 160 ms colour and shadow changes. No lifting cards, no shimmer. `prefers-reduced-motion` switches everything off.

## Files

| File | Job |
|---|---|
| `assets/css/design-tokens.css` | The values: colour, type, spacing, radius, elevation, focus, sizes. Only `:root` custom properties, all prefixed `--ds-`. |
| `assets/css/design-system.css` | The components, all scoped under `.ds`. Loaded after the page's own stylesheet. |
| `scripts/design-contrast.js` | Measures every colour pair from the token file (`node scripts/design-contrast.js`). |
| `tests/design-system.test.js` | Keeps the contrast, the scoping, the CSP and the covered/not covered lists honest. |
| `e2e/design-system.spec.js` | Browser checks on the migrated pages. |

### How a page opts in

1. Add `class="ds"` to `<body>`.
2. Link `design-tokens.css` before the page stylesheet and `design-system.css` after it:

```html
<link rel="stylesheet" href="../assets/css/design-tokens.css">
<link rel="stylesheet" href="../assets/css/hospitals.css">
<link rel="stylesheet" href="../assets/css/design-system.css">
```

3. Delete the inline `background: linear-gradient(...)` on `.main-content` if the page has one.

The Content Security Policy is not touched: both files are same-origin stylesheets, there are no inline scripts and no new origins. A page that has not opted in looks exactly as before, because every rule starts with `.ds`.

## Colour

All pairs below are WCAG 2.x contrast ratios computed by `scripts/design-contrast.js` from the token file. Text needs 4.5:1, the parts of a control that are not text (a field border, a focus ring) need 3:1.

| Pair (foreground on background) | Use | Ratio | Needs |
|---|---|---|---|
| `#15302b` on `#f4f7f6` | body text on the page | 13.08:1 | 4.5 |
| `#15302b` on `#ffffff` | body text on cards | 14.10:1 | 4.5 |
| `#46595a` on `#f4f7f6` | secondary text on the page | 6.87:1 | 4.5 |
| `#46595a` on `#ffffff` | secondary text on cards | 7.40:1 | 4.5 |
| `#46595a` on `#eaf1ef` | secondary text on tinted panels | 6.46:1 | 4.5 |
| `#ffffff` on `#00695a` | primary button label | 6.63:1 | 4.5 |
| `#ffffff` on `#004d42` | primary button label, hovered | 9.81:1 | 4.5 |
| `#00695a` on `#ffffff` | links and outline buttons on cards | 6.63:1 | 4.5 |
| `#00695a` on `#f4f7f6` | links and outline buttons on the page | 6.15:1 | 4.5 |
| `#00695a` on `#dcf0ec` | soft badge | 5.59:1 | 4.5 |
| `#ffffff` on `#b3261e` | emergency button label | 6.54:1 | 4.5 |
| `#ffffff` on `#8c1d18` | emergency button label, hovered | 9.11:1 | 4.5 |
| `#8c1d18` on `#fdeceb` | error alert | 7.97:1 | 4.5 |
| `#5f4200` on `#fff3d1` | warning alert | 8.38:1 | 4.5 |
| `#14532d` on `#e3f5e9` | success alert | 8.03:1 | 4.5 |
| `#0b4f86` on `#e5f0fb` | information alert | 7.34:1 | 4.5 |
| `#d6e4e0` on `#0f2622` | footer text | 12.14:1 | 4.5 |
| `#ffffff` on `#0f2622` | footer links | 15.90:1 | 4.5 |
| `#1a4fd6` on `#ffffff` | focus ring on cards | 6.70:1 | 3 |
| `#1a4fd6` on `#f4f7f6` | focus ring on the page | 6.22:1 | 3 |
| `#ffd166` on `#0f2622` | focus ring on the footer | 11.03:1 | 3 |
| `#6f8580` on `#ffffff` | form field border | 3.93:1 | 3 |

Status is never colour alone: alerts carry a heavy left border, the words themselves and (where the page has Font Awesome) an icon.

## Type

Poppins is already loaded by the pages through the Google Fonts link the CSP allows. The stack falls back to the system UI font, so the layout does not depend on that request succeeding.

| Token | Size | Used for |
|---|---|---|
| `--ds-text-xs` | 0.8125 rem | badges, captions |
| `--ds-text-sm` | 0.9375 rem | navigation, notes, errors |
| `--ds-text-base` | 1 rem | body, form fields, buttons |
| `--ds-text-lg` | 1.125 rem | lead text, small headings |
| `--ds-text-xl` | 1.375 rem | h3 |
| `--ds-text-2xl` | 1.75 rem | h2 |
| `--ds-text-3xl` | 1.875 rem to 2.75 rem, fluid | h1 |

Line height is 1.6 for text and 1.25 for headings. Sizes are in `rem`, so they follow the browser's text size setting.

## Spacing, shape and depth

- **Spacing** is a 4 px scale: `--ds-space-1` (0.25 rem) up to `--ds-space-8` (4.5 rem).
- **Radius**: 8 px (fields, small buttons), 12 px (buttons, cards), 18 px (large panels), pill for badges.
- **Elevation**: three levels. `--ds-shadow-1` resting cards, `--ds-shadow-2` hovered cards and raised buttons, `--ds-shadow-3` menus and the sign-in panel.
- **Touch target**: `--ds-touch` is 44 px. Buttons, nav links, form fields, the hamburger and the search button meet it.
- **Container**: 1120 px wide with 24 px gutters (16 px on a phone).

## Focus

Every interactive element gets `outline: 3px solid var(--ds-focus)` with a 3 px offset on `:focus-visible`. Form fields use a 1 px offset so the ring sits on the border. Inside the footer the ring switches to `--ds-focus-on-dark` (amber), because blue is too dark on that background. The skip link, the focus rule for `main[tabindex="-1"]` and the keyboard rules in [ACCESSIBILITY.md](ACCESSIBILITY.md) are unchanged. Nothing in the layer sets `outline: none` (a unit test checks this).

## Components

New markup can use the `ds-` classes. Existing pages get the same result through the class names they already use.

| Component | New class | Existing classes it also styles |
|---|---|---|
| Header and navigation | n/a | `.healthcare-quote`, `.navbar`, `.logo`, `.nav-links`, `.btn-login`, `.btn-signup`, `.dropdown-menu`, `.hamburger` |
| Footer | n/a | `.footer`, `.footer-section` |
| Button | `.ds-btn`, `--outline`, `--danger` | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-secondary1`, `.btn-emergency`, `.btn-filter`, the sign-in submit |
| Card | `.ds-card`, `--interactive` | `.feature-card`, `.testimonial-card`, `.hospital-card`, `.category-card`, `.card`, `.step`, `.stat-item` |
| Form field | `.ds-field`, `__hint`, `__error` | `.form-group`, `.search-box`, `.search-guides`, `.filter-group`, `.sort-options`, inputs in `main` |
| Alert | `.ds-alert`, `--danger`, `--warning`, `--success` | `.emergency-banner`, `.data-note`, `.demo-notice`, `#form-message` |
| Empty, loading, error state | `.ds-state`, `--loading`, `--error` | `.no-results`, `.loading-state`, `.error-state`, `.saved-empty` |
| Badge | `.ds-badge` | `.service-tag` |
| Skip link | n/a | `.skip-link` |

Loading uses a small spinner that stops under reduced motion and always sits next to words, so it is never the only signal. Error states keep their text and `role` from the page script.

## Coverage

### Migrated in this slice

| Page | Notes |
|---|---|
| Home (`index.html`) | header, hero, sections, cards, footer |
| First aid (`pages/firstaid.html`) | works with no sign-in, as before |
| Hospitals (`pages/hospitals.html`) | filters, cards, states, map section |
| Login (`pages/login.html`) | |
| Sign up (`pages/signup.html`) | |
| Dashboard (`pages/dashboard.html`) | its own `topbar` shell, not the shared header |

### Not migrated yet (follow-up work)

These pages still use the old look and the old per-page CSS variables, and some parts of the pages above (see Known limitations) are only partly restyled. The redesign in issue #130 is **not finished** until they are done.

`pages/about.html`, `pages/accessibility.html`, `pages/admin-panel.html`, `pages/ambulances.html`, `pages/appointments.html`, `pages/blog.html`, `pages/careers.html`, `pages/contact.html`, `pages/cookie-policy.html`, `pages/doctors.html`, `pages/donate.html`, `pages/health-events.html`, `pages/how-it-works.html`, `pages/offline.html`, `pages/pharmacies.html`, `pages/press.html`, `pages/privacy-policy.html`, `pages/privacy.html`, `pages/subscription.html`, `pages/symptoms.html`, `pages/team.html`, `pages/terms-of-service.html`, `pages/volunteer.html`, `404.html`

Suggested order: ambulances and symptoms (emergency paths), doctors and pharmacies (they share the hospitals markup), appointments, contact, subscription, then the content and legal pages.

## Known limitations

- **It is a layer, not a rewrite.** Page stylesheets still contain their old rules and each still defines the old `--primary-color` variables. The layer overrides them by loading last and by specificity. A later step should delete the dead rules page by page, and then fold `style.css` into the tokens.
- **One inline `!important`.** `.main-content` has `background: var(--ds-bg) !important` to beat the inline gradient still on un-migrated markup. Remove it when the last page loses the inline style.
- **Home page sections below the hero** are restyled through shared card, heading and button rules and were checked in screenshots, but the testimonial, newsletter and video sections still have their own old spacing and some old colours.
- **First aid still says "call 911"** and the hospitals page says 112 or 108. Which number to show is a content decision and was left alone here.
- **No dark mode, no right-to-left layout, no high-contrast mode** were designed or tested.
- **Font Awesome icons** come from a CDN that the test browser blocks, so the screenshots show empty icon spaces (search button, category icons, banner icon). On a normal connection they appear as before.
- **Third-party colour.** The Leaflet map, the language switch widget and the Emergency SOS floating button keep their own styles (the SOS button already uses the emergency red).
- **Checked in Chromium only**, at 1366 px and 390 px wide. Firefox, Safari, tablet widths, 200% and 400% zoom were not tested.
- **No real screen reader pass.** The existing keyboard and axe checks were rerun on the migrated pages (see the pull request for results).

## Repeating the checks

```bash
node scripts/design-contrast.js                 # colour pairs, exits 1 if one fails
node --test tests/design-system.test.js         # scoping, CSP, covered and not covered lists
npx playwright test e2e/design-system.spec.js   # browser checks
npx playwright test e2e/accessibility.spec.js   # axe on 18 pages, including the migrated ones
```
