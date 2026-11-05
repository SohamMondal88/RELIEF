# Privacy practices and account deletion

This document describes what the RELIEF code does with data today (Issue #29). It was written by reading every `localStorage`, `sessionStorage`, cookie, `fetch` and external URL in the repository, not from a template. If the code changes, this document has to change with it. `tests/privacy-data.test.js` fails when a script uses a storage key that is missing from the inventory below.

> RELIEF is a demonstration project. Do not enter real patient information. Nothing here is legal advice or a statement of compliance with any privacy law.

## 1. The short version

- RELIEF has **no server of its own** in this repository. Everything you enter is kept in **your browser** (`localStorage`) and is not sent to a RELIEF server.
- RELIEF sets **no cookies**, runs **no analytics** and loads **no advertising or tracking scripts**.
- Some pages load fonts, icons, map code, map tiles and a few images from **third parties**. Those hosts see your IP address (section 4).
- You can delete everything RELIEF stores in your browser from the dashboard: **Your data and account > Delete my account and data** (section 6).
- The real sign-in service (`ReliefAPI`, Firebase) is **not loaded by any page today**. If a deployment connects it, it stores data on a server that this repository cannot delete on its own (section 6.3).

## 2. What is stored in your browser

All of it is `localStorage` for the site's origin. It stays on this device and browser profile until it expires, you delete it, or the browser clears it.

| Key | What it holds | Why | Retention | Personal |
|---|---|---|---|---|
| `relief_demo_users` | Name, email, random salt and PBKDF2 password hash, creation time of demo accounts | Lets you try sign in without a backend. Only written in demo mode (localhost, `file://` or an explicit demo flag) | Until deleted | Yes |
| `relief_users` | Legacy: older builds saved email and a plain text password here | Nothing now | Removed automatically on the next login or signup; also removed by deletion | Yes |
| `relief_auth_sessions` | Session token, signed-in user (id, name, email), device type (mobile or desktop), timestamps | Keeps you signed in | Each session expires 30 days after sign in, newest 10 kept. Logout clears them | Yes |
| `relief_reminders_v1` | Medicine name or label, your note, daily time, start and end date, status | Medicine reminders on the dashboard | Until you remove the reminder or delete your data. The dashboard writes an empty list when it opens | Yes |
| `relief_history_v1` | Timeline entries ("Medication reminder created", medicine name and time) | Dashboard health timeline | Until you delete your data. Two sample entries are added on first open | Yes |
| `relief_appointment_requests` | Your name, email, phone, optional notes, doctor, preferred date and window, consent flag | The appointment request form. It is a request record only, nothing is sent to the doctor | Until you delete your data. Newest 50 kept | Yes |
| `relief_saved_facilities` | Name, address, phone, coordinates and save date of facilities you saved | Saved hospitals work offline | Until you remove one or delete your data | No |
| `userLocation` | Latitude and longitude rounded to 2 decimals (about 1 km), the text you typed for a manual location, source (`gps` or `manual`), save and expiry time | Centres the hospital, pharmacy and ambulance pages on you | Device location expires after 1 day, typed location after 7 days. An expired value is removed the next time a page reads it | Yes |
| `selectedDoctor` | The doctor card (name, specialty, image) you picked from the directory | Passes your choice to the appointment page | Until you pick another doctor or delete your data | No |
| `relief_demo_health_events` | Health events you submitted in demo mode: title, date, venue, organiser, services, eligibility, contact phone or email, moderator decision | Lets the event submission and moderation flow be tried without a backend. Only written in demo mode when the review service cannot be reached (see `HEALTH_EVENTS.md`) | Until you delete your data | Yes |
| `relief_health_event_submissions` | Times and a fingerprint (title, start time, district) of events you submitted | Stops duplicate and repeated event submissions | Entries older than 7 days dropped, newest 50 kept | No |
| `relief_lang` | Language code (`en` or `bn`) | Remembers your language | Until you delete your data | No |
| `relief_last_online_sync` | A timestamp | Offline banner says when the saved copy was refreshed | Overwritten on every online page load | No |
| `relief_formguard_contact` | Timestamps of recent contact attempts, no form content | Slows down repeated submissions (see `FORM_PROTECTION.md`) | Entries older than the limit window (1 to 10 minutes) are ignored and removed | No |
| `relief_formguard_login` | Timestamps of recent login attempts, no form content | Slows down repeated submissions (see `FORM_PROTECTION.md`) | Entries older than the limit window (1 to 10 minutes) are ignored and removed | No |
| `relief_formguard_signup` | Timestamps of recent signup attempts, no form content | Slows down repeated submissions (see `FORM_PROTECTION.md`) | Entries older than the limit window (1 to 10 minutes) are ignored and removed | No |

Other things in the browser, none of which hold personal data:

- **Cache Storage** `relief-static-v1`: copies of the public first aid and hospitals pages and the css, js and logo they need, so they open offline (`sw.js`). Account, dashboard, login and cross-origin requests are never cached. Deletion leaves this cache alone on purpose, because removing it would break offline first aid and it holds nothing about you.
- **sessionStorage, cookies, IndexedDB:** RELIEF code uses none of them. (The Firebase SDK would use IndexedDB if a deployment loads it, see 6.3.)

### Kept only in the page (never saved)

- **Relief Assistant chat:** answered in the browser with no network request and not saved. Reloading or pressing Clear chat removes it.
- **Symptom checker answers:** held in the page while you use it; nothing is written to storage or sent anywhere.
- **Contact form:** the form does not send anything. After "Send" it shows a thank-you message, but no request is made. Do not rely on it to reach anyone.

## 3. What RELIEF does not collect

No analytics, no usage tracking, no advertising identifiers, no cookies, no fingerprinting, no server-side logs written by this code. Personal data is not put in URLs: the doctor you pick is passed through `localStorage`, not the address bar, and no script reads `location.search`.

## 4. Network requests and third parties

These are the requests the pages actually make. Each third party sees your IP address, browser details and the page that asked for the file, under its own privacy policy.

| Who | When | What is sent beyond the IP address |
|---|---|---|
| Font Awesome (`cdnjs.cloudflare.com`, `kit.fontawesome.com`) | Page load, most pages | Nothing |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | Page load, most pages; also when you pick Bengali | Nothing |
| Leaflet code (`unpkg.com`) | Hospitals, pharmacies and ambulances pages | Nothing |
| OpenStreetMap tile servers (`tile.openstreetmap.org`) | Those same three pages, while the map is shown | The map area you are looking at (tile numbers) |
| OpenStreetMap Nominatim (`nominatim.openstreetmap.org`) | Only when you type a place that is not one of the built-in towns in the manual location form | The text you typed, plus ", India" for a PIN code. GPS positions and built-in towns are never sent |
| Google Maps embed (`google.com/maps/embed`) | Contact page, iframe loads with the page | Nothing from you |
| Google Maps directions (`google.com/maps/dir`) | Only when you click Directions (opens a new tab) | Coordinates of the facility, not your position |
| Image hosts (`encrypted-tbn0.gstatic.com`, `kalyaniinfrastructure.com`, `amity.edu`, `jovialjourneys.co.in`) | Home page images | Nothing |
| Your phone or SMS app (`tel:` and `sms:` links) | When you use the SOS buttons | Handled by your device and carrier. The SMS text can include a map link to your location if you allowed location. RELIEF sends nothing to any server unless `window.RELIEF_SOS_ENDPOINT` is set, and it is not set by default |
| The site host (Vercel for the public demo) | Every request | Standard request logs kept by the host. This repository does not control them |

**Not loaded by any page today:** `assets/js/api.js` and `assets/js/firebase-config.js` hold placeholder settings for Firebase, OpenMRS, a local Rasa chatbot and Jitsi. No HTML page includes them, so none of those services is contacted. If a deployment wires them in, this table and the deletion code must be updated first.

## 4.1 Logs and URLs

Checked by searching for `console.` and URL building in `assets/js` and `profiles`:

- No script logs form input, names, emails, phone numbers, passwords, reminders or locations. The remaining `console.error` calls log error objects for sign in checks, logout, storage and service worker failures (`main.js`, `hospitals.js`, `api.js`). `blog.js` logs the blog filter and search words, which are not account or health data.
- The new privacy scripts do not log at all (a test checks this).
- No secrets are committed. The Firebase, Google Maps and Infermedica values in the repository are placeholders.

## 5. Retention policy

1. **RELIEF keeps nothing on a server.** There is no server-side retention to schedule in this repository.
2. **In the browser:** data stays until it expires (sessions 30 days, device location 1 day, typed location 7 days, appointment requests capped at 50), until you remove it, or until you delete it with the button below.
3. **On deletion:** the keys in section 2 are removed immediately and checked afterwards. There is no grace period and no backup copy, so it cannot be undone.
4. **If a deployment connects a sign-in service:** that operator decides server-side retention, including backups and logs, and must publish it. The repository's `deleteAccount` removes the documents it knows about and the sign-in account at once, but cannot reach backups.

## 6. Account deletion

### 6.1 How to delete

Open the dashboard, go to **Your data and account**, press **Delete my account and data**, read the confirmation and press **Yes, delete my data**. Cancel (or the Escape key) leaves everything as it was. The panel first lists what is stored right now.

### 6.2 What it does

Two separate steps, each reported on its own:

1. **Server step** (`ReliefAPI.deleteAccount()`): only for a real, signed-in account.
   - Demo account: no server copy exists, nothing to do (`not-needed`).
   - Nobody signed in: no server is contacted (`not-signed-in`).
   - Sign-in service not connected, which is the case on every page today: reported as **`unavailable`**, with the plain message that an account on a server, if one exists, was **not** deleted.
   - Service connected: the account is `deleted` only if the call answers `{ success: true }`; any error or silence (10 second timeout) is `failed`. An old sign-in is refused before anything is deleted and the message asks you to sign in again.
2. **Local step:** every key in section 2 and any other `relief_*` key is removed from `localStorage`, then each key is read back to confirm it is gone. Unrelated keys from other sites or apps on the same origin (for example when testing on `localhost`) are left alone.

Result shown to you:

| Status | Meaning |
|---|---|
| Account and local data deleted / demo account and local data deleted | Local data is gone and the server part is confirmed deleted or not needed |
| Local data deleted, no account on a server deleted | Local data is gone, but the server was unavailable, failed or not contacted. The message says why and what to do |
| Some data could not be deleted | Names the keys that stayed (for example blocked storage) and tells you to clear the site data in browser settings |
| Nothing was deleted | Browser storage is unavailable |

The local step always runs, even if the server step fails, because you asked to remove data from this device. The message tells you if the server copy may still exist.

After deleting, the language key and the last-visit timestamp are written again the next time you use the site. That is expected and neither is personal.

### 6.3 What this cannot do

- **Delete something on a server that is not there.** This repository has no backend. Real server-side deletion needs a trusted server (for example a function that deletes the user's records and backups). `ReliefAPI.deleteAccount()` does the most a browser can do (documents it creates in `users`, `patients`, `appointments`, `emergencyRequests`, `medicineDeliveries`, then the auth user) and has only been tested against a fake Firebase, not a real project.
- **Delete things you sent elsewhere:** an SMS, a call, a map search on Google or OpenStreetMap, or a request log on a third party.
- **Delete other browsers or devices.** Each browser profile has its own copy.

### 6.4 Deletion request process (server side)

For a deployment that connects a sign-in service, the operator of that deployment is responsible for server-side deletion requests and for publishing a contact for them. This repository has no operator contact of its own (the old policy page listed an address that nothing in the repository backs up, so it was removed). Until a maintainer adds one, open an issue on the [RELIEF repository](https://github.com/SohamMondal88/RELIEF/issues) without personal details and ask for a deletion process for your deployment.

## 7. Your rights

What you can do today, without asking anyone:

- **See your data:** the dashboard lists what is stored. Browser developer tools (Application > Local Storage) show the contents.
- **Correct it:** edit or remove reminders, saved facilities and requests; submit an appointment request again.
- **Delete it:** section 6, or clear the site's data in your browser settings.
- **Withdraw location access:** change the permission in your browser. The saved location expires on its own and is removed by deletion.
- **Move it elsewhere:** not supported yet. There is no export button.

Legal rights such as access, correction or erasure under a specific law depend on where you live and who operates a deployment. This repository cannot promise them.

## 8. Manual privacy verification checklist

Run with a fresh browser profile and developer tools open. Serve the site with `python3 -m http.server 8000` and open `http://localhost:8000/`.

- [ ] **No cookies.** Application > Cookies shows nothing for the site on `index.html`, `pages/dashboard.html` and `pages/hospitals.html`.
- [ ] **No tracking scripts.** Network tab on the home page: only the hosts in section 4 appear, no analytics or advertising host.
- [ ] **Inventory matches.** Sign up (demo), add a reminder, save a facility, set a manual location, send an appointment request. Application > Local Storage shows only keys from section 2.
- [ ] **Nothing sensitive in URLs.** Pick a doctor and continue to the appointment page. The address bar and the network tab URLs hold no name, email, phone or location.
- [ ] **Nothing sensitive in logs.** The console shows no name, email, password, reminder text or coordinates through the whole flow above.
- [ ] **Chat is not stored.** Send a message in Relief Assistant on the dashboard. No new key appears and no request is made. Reload: the chat is empty.
- [ ] **Location expiry.** `userLocation` has an `expiresAt` about 1 day (GPS) or 7 days (manual) ahead.
- [ ] **Delete asks first.** Press Delete my account and data: a confirmation appears and focus moves to it. Cancel: nothing changes, message says nothing was deleted, focus returns to the button.
- [ ] **Delete works.** Confirm: every `relief_*` key, `userLocation` and `selectedDoctor` are gone from Local Storage, unrelated keys are untouched, the reminders list and timeline on the page are empty, and reloading `pages/dashboard.html` shows no old reminders.
- [ ] **Honest message.** As a demo user the message says "demo account". Signed out, or with a real sign-in service missing, it says no account on a server was deleted. It never says "your account was deleted" unless the service confirmed it.
- [ ] **Keyboard and screen reader.** Reach the button with Tab, confirm with Enter, cancel with Escape. The result is announced (status region) and focus lands on it.
- [ ] **Policy pages match.** `pages/privacy-policy.html` and `pages/cookie-policy.html` say no cookies, no analytics and link to the dashboard delete control.

## 9. Known gaps

- No server exists, so server-side deletion cannot be verified end to end here.
- Demo accounts are not secure: a salted hash in `localStorage` protects the password from casual reading, not from someone with access to the browser.
- The dashboard has no sign-in guard. Anyone using the same browser profile sees the same dashboard.
- No data export.
- Third-party hosts (section 4) are not under RELIEF's control. Self-hosting fonts, icons and Leaflet would remove most of them.
- The contact form shows a "received" message without sending anything.

## 10. For contributors

When a script needs a new `localStorage` key: add it to `INVENTORY` in `assets/js/privacy-data.js`, add a row to the table in section 2, and run `node --test tests/privacy-data.test.js`. Keys that start with `relief_` are deleted automatically even if you forget the inventory, but the test will still fail so the docs stay accurate. When a page starts contacting a new host, add it to section 4.
