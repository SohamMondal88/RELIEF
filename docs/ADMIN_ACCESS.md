# Admin controls and who may use them

`pages/admin-panel.html` is a **demo interface**. RELIEF has no trusted backend yet, and nothing in the browser can prove who a visitor is, so the page does not pretend to check. This page lists what each control does today, where the trust boundary is, and what a server has to enforce before any of it is real.

## The rule

- **Hiding a link or a button is not authorization.** Anyone can type the address, open dev tools, edit `localStorage` or call a backend directly. The panel is reachable by everyone (the "Admin Panel" link on `how-it-works.html` is only a convenience).
- Only a **server** can say "this person may approve a correction". The browser may use that answer to decide what to show, never to decide what is allowed.
- While no such server exists, privileged actions are switched off, or kept inside the visitor's own browser and labelled as a demo.

## Every control on the page

| Control | What it does today | Real authorization? |
|---|---|---|
| The page itself | Static HTML, open to everyone | None. There is no sign-in or role check, and the page says so in a banner |
| Triage Queue: **Escalate SOS**, **Assign Doctor** | Nothing. No handler exists, the buttons are `disabled` | None needed, nothing can be changed. A real version must be a server call that checks the caller is staff |
| Provider Verification list, System Metrics | Fixed sample text, labelled "(sample)" | None. It is made-up data, not verified healthcare information |
| Facility corrections: **Refresh**, status filter, list | Asks `ReliefAPI.listFacilityCorrections` (`GET /v1/facility-corrections`) | Server only. 401 and 403 show "You need a moderator account" and the controls stay hidden. With no backend on a normal host the list is not shown |
| **Approve** / **Reject** | Server mode: `POST /v1/facility-corrections/{id}/decision`. Demo mode: writes to this browser's `localStorage` only | Server mode: the server must check the role (below). Demo mode: none, and nothing leaves the browser |
| "Your name" box | Demo log only. In server mode the page does not send it, the server names the moderator from their login | None, a typed name proves nothing |

Demo mode is `localhost`, `127.0.0.1`, a `file://` preview, or `window.RELIEF_DEMO_MODE = true` / `<meta name="relief-demo-mode" content="true">` (`assets/js/auth-mode.js`). The panel shows a note when it is on. On any other host with no reachable backend, the correction queue is not shown and approve and reject do nothing.

## What the page shows in each state

| State | List | Approve / Reject |
|---|---|---|
| Normal host, no backend | Not shown ("cannot be sent right now") | Not shown |
| Normal host, backend down or 5xx | Not shown, no fall back to the browser queue | Not shown |
| Signed out (401) | Not shown, "You need a moderator account" | Not shown |
| Signed in, not a moderator (403) | Not shown, same message | Not shown |
| Moderator (server answers 200) | The server's list | Shown. The server still checks each decision |
| Demo host, no backend | Browser-only demo queue, marked demo | Works on the demo queue only |
| Demo host, backend says 401 or 403 | Not shown, no fall back | Not shown |

Covered by `tests/admin-panel.test.js` (store states, static buttons, no secrets, no role read from storage) and `e2e/admin-panel.spec.js` (the same states in a real browser).

Forged state does nothing: `localStorage` keys such as `isAdmin` or `role`, a made-up `relief_demo_facility_corrections` queue on a normal host, a `?role=admin` in the URL, none of them are read by any script (a test scans for it).

## Trust boundary

| Browser (untrusted) | Server (trusted) |
|---|---|
| Shows or hides sections from the server's answer | Authenticates the session and loads the user's role from its own records |
| Validates input to help honest users | Repeats every check, rate limits, and writes the audit log |
| Keeps a demo queue in `localStorage` | Keeps the real queue and the decision history in one transaction |

## What a server must do

1. Authenticate every request to an admin or moderator endpoint. No session means 401.
2. Look up the role **server side**, from its own database or from a verified token. Never from the request body, a header the page sets, a cookie value the page can edit or a query string.
3. Not a moderator means 403, and nothing is changed, read or leaked in the error.
4. Take the actor (who decided) from the login, not from the request.
5. Reject a second decision on the same correction (409). Write the decision and its history in one transaction.
6. Log who did what and when.

### If admins are built on Firebase

`firebase/firestore.rules` has no admin concept today. It only **blocks** `role`, `roles`, `isAdmin`, `admin`, `verified` and `moderator` on the profile documents, so a user cannot promote themselves, and everything not listed is denied. When roles are added:

- Use a **custom claim** (for example `admin: true` or `moderator: true`) set only from trusted server code with the Firebase Admin SDK. A claim is signed inside the ID token, a field in a Firestore document that the user can write is not.
- In rules, check `request.auth.token.moderator == true`. Do not read a role from a document the same user may edit.
- Add a case to `firebase/emulator/firestore-rules.check.mjs` for each of: signed out, normal user, moderator, and a user trying to write the claim field themselves.
- Claims only refresh when the token does. Decide how fast a removed moderator must lose access (revoke refresh tokens and check `auth_time` for sensitive actions).
- Keep the Admin SDK and its service account on the server. See `docs/FIREBASE_SECURITY.md`.

## Secrets

Everything in a page or a script is public. The repo ships no key, token or service account in browser code: `assets/js/firebase-config.js` holds placeholders and no page loads it, and `tests/admin-panel.test.js` scans every page and script for private keys, service accounts and live API key shapes. A Firebase web `apiKey` is an identifier, not a secret, but it is protected by the rules and App Check, not by hiding it.

## Not done (needs a backend)

- Real sign-in for staff and a role store.
- Server checks on the three `/v1/facility-corrections` endpoints (the contract is in `docs/FACILITY_CORRECTIONS.md`).
- Real triage, provider verification and metrics. The sample cards stay switched off until a server provides data and checks the caller.
- Firestore rules for any admin data, and emulator tests for them.

## Check it yourself

1. `python3 -m http.server 8000`, open `http://localhost:8000/pages/admin-panel.html`. You see the demo banner, the two triage buttons are greyed out, and the corrections box shows the demo note.
2. Open the same server by another host name, for example `http://<your-lan-ip>:8000/pages/admin-panel.html`. The correction queue says it is not reachable, and there is no Approve, Reject or Refresh.
3. In dev tools run `localStorage.setItem('isAdmin','true')` and reload. Nothing changes.
