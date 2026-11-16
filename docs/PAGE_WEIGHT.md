# Page weight

Issue #95. RELIEF is used on slow phones and weak connections, so the pages people open in a hurry should not download megabytes of pictures before they can be used. This page records how the weight is measured, the numbers before and after the change, and what to check when you add a picture or a script.

## How to measure

```bash
node e2e/static-server.js 4173 &                       # or any server for the repository root
node scripts/measure-page-weight.js                    # home, hospitals, ambulances
node scripts/measure-page-weight.js --scroll /index.html   # scroll to the bottom first, so lazy pictures count too
```

`scripts/measure-page-weight.js` opens each page in headless Chromium at 375px wide, waits for the page (the home page shows a splash screen first) and prints the requests and the bytes by type, plus the biggest files. Bytes are what Chrome reports for each response (`Network.loadingFinished`), so they are compressed only if the server compresses. The `e2e/static-server.js` server does not compress, so a real host (Vercel compresses text) sends less for HTML, CSS and JavaScript. Pictures are not made smaller by compression, so the picture numbers carry over.

Requests to other hosts (the icon font, Google Fonts, Leaflet, the testimonial photos on other sites) are blocked by default so the numbers do not depend on a CDN. Add `--external` to let them through. `TOP=20` prints more of the biggest files.

## Before and after (first-party files, 375px wide)

First visit, onboarding skipped, no scrolling:

| Page | | Before | After |
|---|---|---|---|
| Home | requests | 32 | 24 |
| Home | bytes | 2,823,582 | 635,596 |
| Home | of which pictures | 2,634,116 | 445,446 |
| Hospitals | requests | 29 | 29 |
| Hospitals | bytes | 453,439 | 352,169 |
| Hospitals | of which pictures | 127,196 | 25,831 |
| Ambulances | requests | 23 | 21 |
| Ambulances | bytes | 318,273 | 202,853 |
| Ambulances | of which pictures | 127,196 | 11,681 |

Home, after scrolling all the way down (every lazy picture loaded): 2,823,582 bytes before, 990,374 after, so even the full scroll is about a third of what the first screen used to cost.

Scripts, styles and data files are the same before and after. All the change is in pictures and in one script tag.

## What changed

- **Heavy pictures made smaller, same file names and shape (one exception below).** The biggest was `ambulance-icon.gif`, the animation drawn behind the loading splash: 1,852,468 bytes, 640 by 640 pixels, 121 frames, shown in a 100 by 60 box. It is now 195,522 bytes, 120 by 120 with every second frame dropped and the frame time doubled, so the loop is still about 2.4 seconds and the transparent background is kept. The logo (86,833 to 11,486 bytes, 340 pixels, shown at most 170 pixels wide so it is still sharp on a 2x screen), `favicon.jpg` (127,218 to 7,312), the home partner badge (169,102 to 8,967), `partner4.png` (65,316 to 31,760) and `ssl-badge.jpg` (31,515 to 5,498) were the other large ones and were resized to about twice the size they are shown at.
- **The home partner badge has its own file.** `partner2.jpeg` (1200 by 1200) is also the featured picture on the blog, where it is shown about 350 pixels wide, so it is kept as it was. The home page now uses `partner2-badge.jpeg`, a 200 by 200 copy (8,967 bytes) for its 100 pixel badge.
- **Below-the-fold pictures are lazy.** `loading="lazy"` and `decoding="async"` on the partner logos, the video thumbnail, the testimonial photos, the store badges, the app screens and the footer badges (home), and the footer badges (hospitals, ambulances).
- **Every picture on the three pages has a width and a height**, so a picture that arrives late does not move the page. The logo, which had no size on these pages, has one.
- **Not lazy on purpose:** the logo (header and splash) and the home hero photo are on the first screen and load at once.
- **The analytics script is deferred** in the `<head>` of the three pages (`defer`), so it no longer blocks the first paint. It only starts a queue and adds Vercel's own script, and nothing else on the pages calls it.

## What was left alone

- The emergency controls and the scripts behind them (`emergency-sos.js`, `main.js`, `session-guard.js`, `location-service.js`) load as before. Nothing about SOS, the direct call link, facility search or location is deferred or lazy. `tests/page-weight.test.js` and `e2e/page-weight.spec.js` check this, and also check the emergency actions with every picture blocked.
- No framework, bundler or build step was added, and no CSS or script was split or moved.
- The service worker file and its cache version are not touched. Pictures that were already saved in a visitor's cache keep their old bytes until the cache is refreshed by the next version bump, which is harmless.

## Not done here

- `hero-image.jpeg` (118 KB) and `app-screens.png` (209 KB) are still larger than they need to be. The hero is on the first screen and also used on the login and signup pages, so it was left for a separate change that can check how it looks on each page.
- The testimonial photos are hot-linked from other sites. Those are not ours to resize and are lazy now, but they would be better as local files.
- The low-data mode (see the open work on `assets/css/low-bandwidth.css`) is a separate feature.

## When you add a picture or a script

1. Give every `<img>` a `width` and a `height`.
2. Add `loading="lazy"` and `decoding="async"` unless the picture is on the first screen.
3. Save pictures at about twice the size they are shown at, not the size of the camera or the design file.
4. Do not put `defer` or `async` on scripts for emergency actions without testing SOS, the direct call link and the search with a slow connection.
5. Run `node scripts/measure-page-weight.js` before and after and put both numbers in the pull request.
