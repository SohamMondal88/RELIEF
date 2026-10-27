# Public form protection

Relief's public forms (contact, login, signup) go through `assets/js/form-guard.js`.
It adds friction against spam and accidental double submits.

## What it does

| Protection | Behaviour |
| --- | --- |
| Rate limit | Sliding window per form. When the limit is hit the user sees "Too many attempts. Please wait N seconds and try again." and can submit again as soon as the window moves on. |
| Survives reloads | Attempt timestamps are kept in `localStorage` (memory fallback if storage is blocked). |
| Concurrent submits | While a submission is running, further submits are refused. Double clicks and bursts send one request. |
| Honeypot | A hidden `website` field. If it is filled the submission is refused with a generic message. |
| Minimum fill time | Contact form only. Submitting within 1.5s of the page loading asks the user to try again. |
| Safe errors | Messages never mention storage keys, limits or detection rules. |

Login counts **failed** attempts only, so successful logins are never slowed down. A successful login clears the counter.

## Defaults

| Form | Attempts | Window | Counts |
| --- | --- | --- | --- |
| `contact` | 3 | 60 s | every submit |
| `login` | 5 | 5 min | failures only |
| `signup` | 5 | 10 min | every submit |

## Changing the limits

Set a global object **before** the form scripts load, for example in the page head:

```html
<script>
  window.ReliefFormGuardConfig = {
    contact: { maxAttempts: 5, windowMs: 120000 },
    login: { maxAttempts: 10 }
  };
</script>
```

Options per form: `maxAttempts`, `windowMs`, `minFillMs`, `countFailuresOnly`, `honeypotField`.
Invalid values (negative, `NaN`) fall back to the defaults.

## Using it on a new form

```js
const guard = ReliefFormGuard.createGuard('my-form', { maxAttempts: 3 });
ReliefFormGuard.attachHoneypot(form);

const outcome = await guard.run(() => sendIt(), { honeypot: form.elements.website?.value });
if (!outcome.ok) ReliefFormGuard.showGuardMessage(form, outcome.message);
```

## Limits of this approach

This code runs in the user's browser. Someone who calls the backend directly, clears
`localStorage` or edits the page bypasses it. Treat it as a speed bump and a way to give
honest feedback, not as security.

Real enforcement belongs where data is accepted. For this project that means:

- Firebase Security Rules that validate field types and sizes on every write
- Firebase App Check to reject traffic that does not come from the real site
- Firebase Authentication's built-in sign-in throttling and email enumeration protection
- A server or Cloud Function with per-IP limits if forms ever post to our own API

The server-side side of this is in [FIREBASE_SECURITY.md](FIREBASE_SECURITY.md): ready-to-deploy Firestore rules (`firebase/firestore.rules`), opt-in App Check, and the console settings to switch on.

The contact form is currently a simulated submission. When it is connected to a real backend, add the matching rules in the same change (section 4 of that page).

## Tests

```bash
node --test tests/form-guard.test.js
```

Covers invalid input, repeated and concurrent submissions, recovery after the window, failure-only counting, corrupt or blocked storage and configuration.
