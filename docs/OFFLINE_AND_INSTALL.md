# Install and offline support

RELIEF can be installed to a phone or desktop home screen, and the first aid guides and the hospitals page still open after a visit with no internet. This page says exactly what is saved, what is not, and how to check it.

## What is saved

`sw.js` (root of the site) saves only the exact files listed in `PAGE_PATHS` and `ASSET_PATHS`, in one cache named `relief-static-<CACHE_VERSION>`:

| Saved | Why |
|---|---|
| `pages/firstaid.html`, `pages/hospitals.html` | The two approved guidance pages |
| `pages/offline.html` | What people see when a page cannot be reached |
| The css, scripts and locale files those pages load, the logo and favicon | So the saved pages work and can switch language |

Files are fetched from the network first and the saved copy is used only when the network fails, so an online visit always gets the newest files.

## What is never saved

- Dashboard, login, signup, appointments, subscription, doctor, patient, pharmacy and admin pages, and every other page not in the list above. They go to the network only.
- Any answer from an API, Firebase, a backend or an SOS endpoint. The worker only touches `GET` requests to this site for the exact paths above, so a request to anything else is not even seen by the cache code.
- Anything from another site (maps, tiles, fonts, icons, Leaflet, analytics).
- `assets/data/facilities.json`. The facility list can be out of date, so it is not kept. Offline, the hospitals page shows the facilities a person saved themselves (stored in their own browser, see `PRIVACY_AND_DATA.md`).
- Failed answers (404, 500).

The saved copies are the same public files anyone can download. Nothing about an account or about health is in them. Signing out or deleting data does not touch this cache because it holds nothing personal.

## Offline limits (what people are told)

`pages/offline.html` says this on screen, and the saved pages show a banner with the time of the last online visit:

- First aid guides and the hospitals page open only if that page was visited once while online.
- Signing in, the dashboard, appointments, sending an SOS or an appointment request, maps, the full facility list and place search need internet.
- Saved copies can be out of date. First aid guides are general information, not medical advice. Call ahead to confirm facility details.
- In an emergency call 112 or 108. This works with a mobile signal even with no internet. The offline page has these numbers as tap-to-call links and needs no sign-in or location permission.

## Install

`manifest.webmanifest` (linked from `index.html`, `pages/firstaid.html`, `pages/hospitals.html`) names the app, sets `display: standalone`, a green theme colour and three icons (192, 512 and a maskable 512). `start_url` and `scope` are relative, so they follow wherever the site is hosted.

- Chrome or Edge on desktop and Android: open the site over `https://`, then use the install button in the address bar or the browser menu (Install app or Add to Home screen).
- Safari on iPhone: Share, then Add to Home Screen.
- The home page is not saved. If the installed app is opened with no internet it shows the offline page, which links to the saved first aid and hospitals pages.

## Hosting notes (Vercel)

- `sw.js` must stay at the site root so its scope is the whole site. Do not move it into `assets/`.
- Do not give `sw.js` a long `Cache-Control`. Vercel's default for static files (`max-age=0, must-revalidate`) is right, because browsers need to see a new `sw.js` quickly to update. If a `vercel.json` with a header rule for `/(.*)` is added, leave `sw.js` out of any long-lived cache rule.
- The worker matches paths like `/pages/firstaid.html`. If `cleanUrls` is switched on later (`/pages/firstaid`), update the lists in `sw.js`.
- Service workers need `https://` (or `localhost`). They do not run from `file://`.
- If a Content Security Policy is added, it needs `worker-src 'self'` and `manifest-src 'self'`.

## Updating

1. Change files as usual. Saved files refresh themselves on the next online visit.
2. If you **add, remove or rename** a path in `PAGE_PATHS` or `ASSET_PATHS`, bump `CACHE_VERSION` in `sw.js` (`'v5'` to `'v6'`). The new worker saves the new list, then on activate deletes every `relief-static-*` cache with another version. Caches with other names are left alone.
3. The new worker takes over straight away (`skipWaiting` and `clients.claim`), so the next load uses the new files.
4. A new page can only be added to the list if it holds no account data and is public guidance. Add its local scripts and styles too. `tests/pwa.test.js` fails when a listed page loads a local script or stylesheet that is not saved, and when a private-looking path is listed.

## Check it yourself

Run the site locally (`python3 -m http.server 8000`) and open `http://localhost:8000/pages/firstaid.html` in Chrome.

**Install metadata.** DevTools, Application, **Manifest**: no errors and the three icons show. The Installability section lists nothing missing.

**Offline.**
1. Visit `pages/firstaid.html` and `pages/hospitals.html` once online. Application, Cache Storage, `relief-static-v5` lists them.
2. Application, Service Workers, tick **Offline**.
3. Reload `pages/firstaid.html`: the guides open with the "You are offline. This is a saved copy" banner.
4. Open `pages/dashboard.html` or `index.html`: you land on `pages/offline.html`, not on the browser's error page and not on any account content.
5. Cache Storage must not contain dashboard, login, signup, `facilities.json` or any API address.

**Update.**
1. With the page open, edit `CACHE_VERSION` in `sw.js` (for example to `'v6'`).
2. Reload twice (or Application, Service Workers, Update). The new worker installs and activates.
3. Cache Storage now shows `relief-static-v6` and the old `relief-static-v5` is gone.

Automated: `node --test tests/pwa.test.js` runs `sw.js` with a fake cache and network (install, cleanup on activate, what is and is not saved, the offline fallback). `npx playwright test e2e/pwa.spec.js e2e/firstaid-offline.spec.js` checks the manifest in a real browser and the offline behaviour.
