# Low-data mode

A switch for slow mobile networks and low-end phones. It is on the home page, hospitals, ambulances (SOS) and first aid pages, which are the essential ones. It loads less and moves less, and it never gets in the way of SOS, facility search, first aid or a phone link.

## Turning it on and off

A small bar at the top of each of those pages says "Low-data mode is off." with a **Turn on low-data mode** button. When it is on the bar says so and the button reads **Turn off** (`aria-pressed="true"`). The choice is kept in this browser as `relief_low_bandwidth` (`on` or `off`, see `PRIVACY_AND_DATA.md`) and applies to the four pages. If the browser will not store it, the mode still works for the page you are on and the bar says it will not be remembered.

The mode **never turns itself on**. If the browser reports Data Saver or a slow connection (`navigator.connection.saveData`, or `effectiveType` of `slow-2g`, `2g` or `3g`; not every browser has this) and nobody has chosen yet, the bar offers it: "Turn on" or "Not now". "Not now" is remembered as `off`, so the offer does not come back.

## What it does while on

`assets/js/low-bandwidth.js` (loaded from `<head>`) puts the class `relief-lite` on `<html>` before the page is drawn, and `assets/css/low-bandwidth.css` (every rule scoped to that class) then:

- turns off every animation and transition, and smooth scrolling;
- skips the 3 second landing splash on the home page, and does not use its animated ambulance picture (1.85 MB);
- hides decorative pictures in the page body and footer: hero and video photos, partner logos, app screenshots, store and certificate badges, testimonial photos. The brand logo and map tiles/markers stay;
- marks the pictures it hides as `loading="lazy"` while the page is being read, so the browser does not download a hidden picture. Pictures that script adds later (map tiles) are not touched.

It does not hide or change text, buttons, links, forms, the SOS dialog, facility search, first aid guides or any `tel:` link, and no critical action waits for a picture or an animation. A test checks that no rule in the stylesheet targets those.

## Reduced motion

`prefers-reduced-motion: reduce` is a system setting and stays in charge on its own: the existing `@media (prefers-reduced-motion: reduce)` rules and the scripts that read it (splash delay, scrolling) are not changed. The mode adds the same effects for people who have not set it. Turning the mode off does not remove those rules: a browser test compares the computed transition of a button before the switch and after turning the mode on and off again.

## Measured

Local static server, no compression, headless Chromium, 375px wide, requests to outside hosts (fonts, icon font, Leaflet) blocked so the numbers do not depend on a CDN. "Transferred" is the body size reported by Chrome (`Network.loadingFinished`). Run on 13 November 2026.

| Page | Mode off | Mode on |
|---|---|---|
| Home | 33 requests, 2,833,941 B | 20 requests, 287,220 B |
| Hospitals | 31 requests, 463,987 B | 29 requests, 423,820 B |
| Ambulances | 25 requests, 328,821 B | 23 requests, 288,654 B |
| First aid | 17 requests, 262,156 B | 15 requests, 221,989 B |

On slow 3G as Chrome DevTools defines it (400 ms round trip, 400 kbit/s), time until the page content is visible:

| Page | Mode off | Mode on |
|---|---|---|
| Home | 56,979 ms | 7,496 ms |
| Hospitals | 14,280 ms | 13,722 ms |

The home page gains most: the splash picture and the decorative photos are most of its weight, and the splash no longer waits 3 seconds. The other three pages only lose the footer badges (about 40 KB), because their weight is scripts and the facility list. Those are not changed here. Each number is one run, so treat the timings as rough.

Not measured: Firefox and Safari. The `loading="lazy"` step needs the browser to honour the attribute before it starts a picture. Where it does not, the pictures are hidden but may still be downloaded.

## For developers

- Everything outside the bar is scoped to `html.relief-lite`. New decorative pictures are hidden automatically in `main`, `.main-content` and `footer`; give a picture that must stay the class `logo` or `brand` on an ancestor.
- A new page that should have the mode needs the stylesheet and the script in `<head>` (see `pages/hospitals.html`). If the page is saved offline, add both files to `sw.js` and bump `CACHE_VERSION`.
- Tests: `tests/low-bandwidth.test.js` and `e2e/low-bandwidth.spec.js`.
