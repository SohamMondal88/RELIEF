# Session expiry and cross-tab sign-out

`assets/js/session-guard.js` decides when a signed-in session ends and keeps every open
tab in agreement. `assets/js/main.js` still creates and stores the session
(`relief_auth_sessions` in `localStorage`).

## When a session ends

| Cause | Rule | Reason shown to the user |
| --- | --- | --- |
| Inactivity | No click, key press, touch or scroll for 30 minutes | "You were signed out because you were inactive for a while." |
| Lifetime | 7 days after sign-in, however active the user is | "Your session has expired." |
| Sign-out in another tab | The other tab clears the session | "You were signed out in another tab." |
| Refresh failure | The sign-in service rejects the periodic token refresh | "We could not confirm your sign-in." |
| Tampering | Missing user, non-numeric times, or times far in the future (changed clock, edited storage) | Treated as expired |

Previously a session lasted 30 days with no idle limit.

Change the timeouts before the scripts load:

```html
<script>
  window.ReliefSessionConfig = { idleTimeoutMs: 15 * 60 * 1000, absoluteTimeoutMs: 24 * 60 * 60 * 1000 };
</script>
```

Other options: `checkIntervalMs`, `refreshIntervalMs`, `touchThrottleMs`. Invalid values fall back to the defaults.

## What happens in an open tab

1. Each tab re-checks its session every 30 seconds, when it regains focus and when it becomes visible again.
2. Activity extends the idle window. The write to storage is throttled to once every 30 seconds, and activity can never revive a session that has already expired.
3. When a session that this tab had is gone, the tab:
   - empties every element marked `data-protected` (the dashboard) so a stale tab stops showing personal data,
   - resets the navigation to the signed-out state,
   - shows an accessible dialog (`role="alertdialog"`, focus moves to the **Sign in** link).
4. Pages that were never signed in (anonymous visitors) are never interrupted.

To protect another page, add `data-protected` to the element holding personal data.

## Cross-tab sign-out

Pressing **Logout** calls `ReliefSessionGuard.signOutEverywhere()`. Other tabs hear about it through
`BroadcastChannel` where available and through the `storage` event everywhere else, so it also works
in browsers without `BroadcastChannel`.

## Refresh with the sign-in service

When the Firebase-backed `ReliefAPI` is present, the guard calls `ReliefAPI.refreshSession()`
every 10 minutes (it forces a fresh ID token). If that fails, for example because the account was
disabled or access was revoked, the session ends immediately. With no real sign-in (demo mode) there
is nothing to refresh.

## What this does not do

- The session in the browser is **UI state**. It controls what the page shows. It does not protect data. Access to stored data is authorised by the server: see the Firestore rules in [FIREBASE_SECURITY.md](FIREBASE_SECURITY.md).
- Medicine reminders, the health timeline and appointment requests are kept in `localStorage` on the device and are not removed on sign-out, because they are not tied to an account. Use "Delete my account and data" ([PRIVACY_AND_DATA.md](PRIVACY_AND_DATA.md)) to remove them.
- Anyone with access to the browser's developer tools can edit local storage. That can only change what their own page shows, never what the server allows.

## Logging

The guard never writes session tokens, emails or errors from the sign-in service to the console. A test fails if a `console.*` call is added to the file.

## Tests

```bash
node --test tests/session-guard.test.js
```

Covers the expiry policy, idle and absolute limits, clock changes, activity, several tabs signing out
(with and without `BroadcastChannel`), refresh success and failure, blocked or corrupt storage, the
sign-in prompt and the page wiring.
