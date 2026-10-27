# Content Security Policy and browser security headers

RELIEF is a static site, so the policy is delivered two ways and both must say the same thing:

1. **A `<meta http-equiv="Content-Security-Policy">` tag in every page.** Works on any host, including GitHub Pages, a `python3 -m http.server` preview and the offline copy kept by `sw.js`.
2. **Response headers from the host.** `vercel.json` holds them for Vercel, which the README names as the live deployment. Other hosts need the same headers (see "By deployment environment").

`tests/security-headers.test.js` fails if a page, `vercel.json` and the list of what the pages load drift apart.

## What a meta tag cannot do

Browsers ignore these in a `<meta>` CSP, so they only exist in the headers:

- `frame-ancestors` (clickjacking protection). The header version has `frame-ancestors 'none'`, plus `X-Frame-Options: DENY` for old browsers.
- `report-uri` / `report-to` (violation reports).
- `sandbox`.
- **Report-Only mode.** `Content-Security-Policy-Report-Only` is a header, there is no meta form of it. Without a header, the only feedback is the browser console.
- `X-Content-Type-Options` and the other headers below.

So a host that cannot set headers (GitHub Pages) gets the script, style, image and connection limits, but no clickjacking protection and no `nosniff`.

## The policy

Copy of what is in every page (`vercel.json` adds `; frame-ancestors 'none'`):

| Directive | Allows | Why |
|---|---|---|
| `default-src` | `'self'` | Anything not listed below must come from the site itself |
| `script-src` | `'self'`, `https://unpkg.com/leaflet@1.7.1/dist/leaflet.js` | Own scripts (including `assets/js/vercel-analytics.js`, which adds the same-origin `/_vercel/insights/script.js`), plus the one Leaflet file used by the three map pages. No `'unsafe-inline'`, no `'unsafe-eval'`. The path is exact on purpose: unpkg serves any npm package, so allowing the whole origin would let an injected `<script src="https://unpkg.com/anything">` run |
| `style-src` | `'self'`, `'unsafe-inline'`, Leaflet css (exact file), `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/`, `https://fonts.googleapis.com/` | Own css, Font Awesome, Leaflet css, Google Fonts css. `'unsafe-inline'` is an accepted exception, see below |
| `font-src` | `'self'`, cdnjs Font Awesome path, `https://fonts.gstatic.com` | Font Awesome icon font, Google Fonts files |
| `img-src` | `'self'`, `data:`, `https://*.tile.openstreetmap.org`, `https://unpkg.com/leaflet@1.7.1/dist/images/`, `https://encrypted-tbn0.gstatic.com`, `https://jovialjourneys.co.in`, `https://kalyaniinfrastructure.com` | Map tiles, Leaflet marker icons, one css `data:` icon, three hotlinked testimonial photos (exception) |
| `connect-src` | `'self'`, `https://nominatim.openstreetmap.org` | `facilities.json`, language files, the place search in `location-service.js`, and the Vercel Web Analytics beacon (`/_vercel/insights/...` is served from the same origin on Vercel, so it needs no extra entry) |
| `frame-src` | `https://www.google.com/maps/embed` | The map on the contact page |
| `worker-src` | `'self'` | `sw.js` |
| `manifest-src` | `'self'` | No manifest yet, closed anyway |
| `media-src` | `'none'` | No audio or video |
| `object-src` | `'none'` | No plugins |
| `base-uri` | `'self'` | An injected `<base>` cannot redirect relative script paths |
| `form-action` | `'self'` | A form cannot be pointed at another site. Every form is handled by JavaScript today |

## What the site loads today (inventory)

Taken from the pages and scripts, then checked in a browser (see "How it was tested").

| Kind | What | Where |
|---|---|---|
| Scripts | Own files under `assets/js/` | every page |
| | Leaflet 1.7.1 from unpkg | `hospitals`, `pharmacies`, `ambulances` |
| | Inline scripts | none. `ambulances.html` had one (`EmergencySOS.init`), removed: `emergency-sos.js` already starts itself when the trigger button exists, and `init()` returns the existing instance |
| | Inline event handlers, `javascript:` links, `eval`, string timers, `document.write` | none (tests scan for them) |
| Styles | Own css under `assets/css/` | every page |
| | Font Awesome 6.0.0-beta3 (11 pages) and 6.4.0 (2 pages) from cdnjs | most pages |
| | Leaflet css from unpkg | the three map pages |
| | Google Fonts css (Poppins, Open Sans) and, after switching to Bengali, Noto Sans Bengali (`i18n.js`) | 5 pages and `i18n.js` |
| | Inline `style="..."` attributes | 33 in 17 pages, plus some built by 4 scripts (`doctors.js`, `pharmacies.js`, `onboarding.js`, `profiles/ambulance/ambulance.js`) |
| | Inline `<style>` blocks | `cookie-policy`, `privacy-policy`, `terms-of-service`; also created by `main.js` (back to top button) and `i18n.js` (language switch) |
| Fonts | Font Awesome files from cdnjs, Google Fonts files from fonts.gstatic.com | |
| Images | Own files, a `data:` svg in `contact.css`, map tiles `{a,b,c}.tile.openstreetmap.org`, Leaflet marker icons from unpkg | |
| | Hotlinked photos on `index.html`: encrypted-tbn0.gstatic.com, jovialjourneys.co.in, kalyaniinfrastructure.com | testimonials and partners |
| Frames | Google Maps embed | `contact` |
| Requests from scripts | `facilities.json`, `assets/locales/*.json` (own origin), `nominatim.openstreetmap.org` | `hospitals`, `pharmacies`, `ambulances`, any page with the location panel |
| | Set at deploy time, not set by any page today: `window.RELIEF_SOS_ENDPOINT` (`emergency-sos.js`), `window.RELIEF_BACKEND_URL` (`api.js`) | see "When you add an integration" |
| Workers | `sw.js` | every page with `main.js` |
| Not used by any page | Firebase SDK, Google Maps JS (commented out in `contact.js`), the Rasa, OpenMRS and OSM API urls in `api.js`, Jitsi (`api.js` only builds a link) | not in the policy |

## Accepted exceptions

| Exception | Why | How to remove it |
|---|---|---|
| `style-src 'unsafe-inline'` | 33 style attributes (and a few more built by scripts), 3 `<style>` blocks and 2 script-injected style elements exist today (inventory above). Moving all of them into css files touches about 20 files and a few of them are toggled with `element.style.display`, so it needs its own change. This lets injected markup restyle a page, it does not let it run script | Move the styles into css files, then delete the keyword. The policy test will then show the exact line to change |
| `img-src data:` | One css background icon in `contact.css` | Replace by a file |
| Three hotlinked photo origins in `img-src` | `index.html` loads images straight from other people's websites. This sends every visitor's address to those sites and breaks when they move the file | Copy the images into `assets/images/` and delete the three origins |
| Google Maps `iframe` | The contact page embed | Replace by a static map image or a link |
| One refused image | The photo for "Manoj Singh" on `index.html` points to `www.amity.edu`, which redirects to `backoffice.amity.edu`. Chrome already refuses to show it today (ORB block, `ERR_BLOCKED_BY_ORB`), with or without a policy. It is left out of the policy on purpose, so the console shows one violation on the home page | Replace the photo. Also check that the testimonial photos and names are the real people's |

## Integrity of third-party files

The four CDN stylesheet and script tags (Leaflet js and css, Font Awesome 6.0.0-beta3 and 6.4.0) carry `integrity="sha384-..."` and `crossorigin="anonymous"`. If the file at that url ever changes, the browser refuses it. The Leaflet hashes were checked against the published sha512 values for 1.7.1. Google Fonts css is not pinned because Google returns different css per browser. When you bump a version, update the hash in every page (a test checks that the same file has the same hash everywhere).

## Referrer policy

`strict-origin-when-cross-origin` (meta tag in each page and `Referrer-Policy` header). Pages send nothing sensitive in the address, but this stops full paths going to other sites. Do not use `no-referrer`: the OpenStreetMap tile servers and Nominatim refuse requests with no referrer, so the maps would go blank.

## Other headers (`vercel.json`)

| Header | Value | Notes |
|---|---|---|
| `Content-Security-Policy` | the policy above plus `frame-ancestors 'none'` | |
| `X-Content-Type-Options` | `nosniff` | Stops a file served as text being run as a script or style |
| `X-Frame-Options` | `DENY` | Old browsers that do not know `frame-ancestors`. Nothing in RELIEF should be framed by another site |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=(), payment=(), usb=()` | The location panel and SOS need geolocation. Camera, microphone, payment and usb are not used. When a payment provider is added, relax `payment` |

Looked at and not set:

- `Strict-Transport-Security`: Vercel already sends it on its domains. On another host, send `max-age=31536000` once https works everywhere. Add `includeSubDomains` or `preload` only when the owners are sure about every subdomain.
- `Cross-Origin-Opener-Policy`: little to gain, nothing here uses `window.opener`.
- `Cross-Origin-Embedder-Policy`: would block the map tiles and hotlinked images.
- `X-XSS-Protection`: obsolete, can introduce problems in old browsers, left out.

## By deployment environment

Use the same policy text. Replace `<POLICY>` with the value from `vercel.json`.

**Vercel (live site):** `vercel.json` in the repo root is picked up on the next deploy. Check a preview deployment first (see "Rolling out"). Nothing else to do.

**Netlify or Cloudflare Pages:** a file named `_headers` in the publish folder:

```
/*
  Content-Security-Policy: <POLICY>; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()
```

**nginx:**

```
add_header Content-Security-Policy "<POLICY>; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" always;
```

**Apache (`.htaccess`, needs mod_headers):** `Header always set Content-Security-Policy "<POLICY>; frame-ancestors 'none'"` and the same pattern for the other four.

**Firebase Hosting:** a `headers` block in `firebase.json` with `"source": "**"` and the same five key/value pairs.

**GitHub Pages:** custom headers are not possible. Only the meta tags apply. No `frame-ancestors`, no `nosniff`, no Report-Only. If clickjacking protection matters, put the site behind a host or CDN that can add headers.

**Local preview (`python3 -m http.server`, opening `index.html`):** meta tags only.

## Rolling out and report-only

Report-Only needs a header, so on a host that can set one:

1. Send the policy as `Content-Security-Policy-Report-Only` first (rename the key in `vercel.json` on a preview branch), open every page, and read the console for `[Report Only]` lines. Add a `report-to` or `report-uri` endpoint only if you run something that collects reports. There is none in this repo.
2. When the console is clean, switch the key back to `Content-Security-Policy`.

For this change that was done locally with the final policy sent as a Report-Only header on unmodified `main` (see below). The pages themselves now enforce it through the meta tag.

## When you add an integration

Change the meta tag in every page and `vercel.json` together (the test fails otherwise), then add it to this document.

- **RELIEF backend** (`window.RELIEF_BACKEND_URL` or `<meta name="relief-backend-url">`): add its origin to `connect-src`. Until then, calls to it are refused by the browser.
- **SOS dispatch endpoint** (`window.RELIEF_SOS_ENDPOINT`, read by `emergency-sos.js`): use a path on the same site (for example `/api/sos`) or add its origin to `connect-src`. Without that, the browser refuses the request and the dialog says the connection failed. `e2e/sos.spec.js` now uses a same-origin path for this reason.
- **Firebase sign-in** (no page loads the SDK today): `script-src` for the SDK file, `connect-src` for `https://*.googleapis.com` and the project's `https://<project>.firebaseapp.com`, and probably `frame-src` for the sign-in popup. This was not tested, no Firebase project exists.
- **Payment provider:** its script and frame origins, and `Permissions-Policy: payment`.
- **Google Maps JavaScript API** (commented out in `contact.js`): script, `connect-src` and `img-src` for `maps.googleapis.com` and `maps.gstatic.com`.
- **Another CDN file:** add the exact path, add `integrity` and `crossorigin="anonymous"`, never the whole origin.

## How it was tested

Real Chromium 1243 (Playwright) against local copies of the site, the home page and every file in `pages/` (27 files, `home.html` is empty), plus the Bengali version of the home and hospitals pages, listening for `securitypolicyviolation` events and console errors.

1. **Inventory:** unmodified `main` with `Content-Security-Policy-Report-Only: default-src 'none'`. Every request the pages make is reported, which gives the list above.
2. **Report-only:** unmodified `main` with the final policy as a Report-Only header. Result: 1 violation, the inline script on `ambulances.html` (removed in this change), plus the dead amity photo.
3. **Enforced through the meta tags**, then again with the header as well. Result: no violations except the dead amity photo.
4. **Behaviour before and after the policy:** icons, Google and Bengali fonts, Leaflet maps with tiles and 46 markers, the facility list, a place search through Nominatim, the SOS dialog, the language switch, the service worker, the contact map frame, the back to top button, legal page styles. Same result in both.
5. **Injection attempt:** markup with an inline `onerror`, an inline `<script>` and a script from another CDN added to a page. Without the policy all three ran. With it none ran and the console shows `Executing inline event handler violates ... script-src` and the same for the script tags. This simulates an injection flaw, the site has no known one.

Not covered: Firefox and Safari, a real deployment on Vercel, anything behind sign-in (no backend exists), the Firebase and backend integrations, other languages than English and Bengali.
