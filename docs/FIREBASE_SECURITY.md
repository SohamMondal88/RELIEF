# Firebase security (rules and App Check)

The browser-side limits in [FORM_PROTECTION.md](FORM_PROTECTION.md) only slow people down.
Anyone can skip the website and talk to Firebase directly, so the real protection has to
live in Firebase. This page covers what the repository ships and what you must switch on
in the Firebase console.

> No page loads Firebase today (see [PRIVACY_AND_DATA.md](PRIVACY_AND_DATA.md)). Do this
> before connecting a real project.

## 1. Firestore Security Rules

`firebase/firestore.rules` covers every collection that `assets/js/api.js` writes to:
`users`, `patients`, `appointments`, `emergencyRequests`, `medicineDeliveries`.

| Rule | Why |
| --- | --- |
| Everything not listed is denied | A new or misspelled collection is closed by default |
| Users read, write and delete only their own documents | No reading other people's health data |
| `userId` on a new request must be the signed-in user | A request cannot be filed in someone else's name |
| `status` must start as `pending` / `requested` and `createdAt` / `timestamp` must be the server time | A client cannot pre-approve or back-date a request |
| Requests cannot be updated by the client | Status changes belong to a trusted server |
| Profiles cannot contain `role`, `isAdmin`, `admin`, `verified`, `moderator` | No self-promotion |
| Field count and text length are capped | Stops oversized spam payloads |

### Deploy

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase use <your-project-id>
firebase deploy --only firestore:rules
```

### Test the rules

Without the emulator (runs in `npm test`): `node --test tests/firebase-rules.test.js`
checks that every collection used by `api.js` has a rule, that nothing is open to
everyone and that requests cannot be edited by the client.

With the Firebase emulator (needs Java 11+): this proves the rules actually allow and
deny the right things.

```bash
cd firebase/emulator
npm install
npm run check
```

It covers owner-only access, forged owners, forged status and timestamps, privileged
fields, oversized payloads, unfiltered list queries and unknown collections.

### What rules cannot do

Rules see one request at a time. They cannot count requests per IP address or per minute.
Use App Check and quotas (below) for that. If you later need a per-user cooldown, the usual
pattern is a small `rateLimits/{uid}` document that every write must also update, checked
with `request.time`. That requires writes to go through a batch, so it is not included yet.

## 2. App Check

App Check makes Firebase reject requests that do not come from your real site.

1. In the Firebase console open **App Check**, register your web app with **reCAPTCHA v3** and keep the site key.
2. Load the App Check SDK next to the other Firebase scripts: `firebase-app-check-compat.js`.
3. Set the key before `api.js` loads:

   ```html
   <script>window.RELIEF_APP_CHECK_SITE_KEY = 'your-recaptcha-v3-site-key';</script>
   ```

   `api.js` then calls `firebase.appCheck().activate(key, true)`. With no key it does nothing,
   so local development keeps working.
4. Watch **App Check > APIs** for a few days and make sure legitimate traffic is verified.
5. Switch on **Enforce** for Cloud Firestore. Enforce for Authentication only if your plan supports it (it needs Identity Platform).

For `localhost`, create a **debug token** in the console and set
`self.FIREBASE_APPCHECK_DEBUG_TOKEN = '<token>'` in your local page. Never commit the token.

## 3. Other console settings

- **Authentication > Settings:** turn on **email enumeration protection** so login and signup do not reveal which emails exist.
- **Authentication > Sign-in method:** keep only the providers you use.
- **Authorized domains:** list only your real domains.
- **Usage and billing:** set budget alerts and a Firestore daily quota so abuse cannot run up costs unnoticed.
- Firebase Authentication already throttles repeated sign-in attempts and answers with `auth/too-many-requests`. The site shows that as the normal "Too many attempts" message.

## 4. Contact form

The contact form is a simulated submission today. When it is connected to a backend:

1. Store messages in a new collection (for example `contactMessages`) with a rule that allows `create` only, validates field types and lengths, and denies `read`/`update`/`delete`.
2. Add the collection to `firestore.rules` and a case to `firebase/emulator/firestore-rules.check.mjs`.
3. Keep App Check enforced for Firestore so the form cannot be posted to from outside the site.

`tests/firebase-rules.test.js` will fail if `api.js` starts using a collection that has no rule.
