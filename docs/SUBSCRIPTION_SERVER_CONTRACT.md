# Subscription server contract

This repo has no backend. The subscription page is built so that a backend can be added later without changing the UI, and so that until then the UI never pretends anyone has paid. This page describes what that backend has to do. The client side is `assets/js/subscription-state.js`, `assets/js/subscription.js` and `ReliefAPI.verifySubscription()` in `assets/js/api.js`.

## The rule

**A paid feature is shown as on only when the server, answering a request made right now, says so.** The browser's own storage, cookies it can set, URL parameters and a payment "success" page are never evidence of payment, because the person using the browser can change all of them.

If the server cannot be reached, times out, answers with an error, or answers with something that does not match this page, the client shows **"Could not verify your subscription"**, treats the state as `unknown`, and turns every paid feature off.

The client check only protects the display. The server must also check the subscription on every paid action (a booking, a chat, a discount) and not rely on the page having hidden a button.

## States

| State | Meaning | Paid features |
|---|---|---|
| `none` | No subscription, or a first payment that failed | off |
| `pending` | A payment was started and the provider has not confirmed it | off |
| `active` | Paid, and the paid period has not ended | on, as listed in `features` |
| `past_due` | A renewal payment failed | off |
| `cancelled` | Cancelled, or refunded | off |
| `unknown` | Client only. The server could not be asked, or its answer was invalid | off |

The server never sends `unknown`. The client makes it.

How this maps to the wording in issue #30:

- successful payment -> `active`
- pending -> `pending`
- failed -> `past_due` (a renewal) or `none` with `lastPaymentResult: "failed"` (a first payment)
- cancelled -> `cancelled`
- refunded -> `cancelled` with `lastPaymentResult: "refunded"`

## Endpoint: read the subscription

```
GET /v1/subscription
```

- The user is identified by the server's own session (cookie or bearer token). The request carries **no** plan, status or user id from the page, and the server must ignore any it receives.
- HTTPS only. The client refuses a plain `http://` backend unless it is `localhost` or `127.0.0.1`.
- The response must send `Content-Type: application/json` and `Cache-Control: no-store`. The client also asks for `cache: no-store`.
- If the page and the API are on different origins, the API must send `Access-Control-Allow-Origin` for the exact page origin (not `*`) and `Access-Control-Allow-Credentials: true`.
- `401` when not signed in (the client shows "Sign in to see your plan"). Other `4xx` and `5xx` are shown as "could not verify".

### Response body

```json
{
  "schemaVersion": 1,
  "status": "active",
  "plan": "plus",
  "billingPeriod": "monthly",
  "features": ["priority_booking", "pharmacy_discount", "emergency_callback"],
  "currentPeriodEnd": "2026-11-26T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "lastPaymentResult": "succeeded",
  "serverTime": "2026-10-26T10:00:00Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Must be `1`. Anything else is rejected |
| `status` | string | One of `none`, `pending`, `active`, `past_due`, `cancelled` |
| `plan` | string or null | `basic`, `plus` or `family`. Required when `active` |
| `billingPeriod` | string or null | `monthly` or `yearly` |
| `features` | string[] | Only read when `active`. Ids the client knows: `doctor_chats`, `symptom_history`, `medicine_reminders`, `priority_booking`, `pharmacy_discount`, `emergency_callback`, `family_cover`, `nurse_helpline`, `care_coordinator`. Unknown ids are dropped |
| `currentPeriodEnd` | ISO 8601 string or null | Required when `active` |
| `cancelAtPeriodEnd` | boolean | If true while `active`, the UI says the plan will not renew. Access continues until `currentPeriodEnd` |
| `lastPaymentResult` | string or null | `succeeded`, `failed` or `refunded`. Only changes the wording |
| `serverTime` | ISO 8601 string | The server's clock. The client compares `currentPeriodEnd` to this, not to the browser's clock |

The client checks all of this. An `active` response with an unknown plan, a missing or past `currentPeriodEnd`, or no `features` array is treated as `unknown`, not as `active`.

### What "verification" means here

There is no signature on this response that the browser verifies. A browser cannot protect itself from its own user, and over HTTPS the page already knows the answer came from the server it asked. What protects the money is the server:

- It decides the state from its own database, which is only changed by verified provider events (below).
- It re-checks the subscription on every paid action.
- If we later need the answer to survive untrusted caches or proxies, the response can be wrapped as a signed token (for example a short-lived JWS) and `normalize()` extended to check it. That is not built.

## Endpoint: provider callbacks (webhook)

```
POST /v1/webhooks/<provider>
```

This is the only thing allowed to move a subscription towards `active`. The page, the redirect after checkout and the browser never do.

1. **Verify the signature first.** Use the provider's documented scheme (usually an HMAC of the raw request body with a webhook secret, plus a timestamp). Compare in constant time, reject old timestamps, and use the raw bytes, not re-serialised JSON. Reject with `400` on failure and change nothing.
2. **Be idempotent on the provider's event id.** Keep a table of processed event ids with a unique constraint. Insert the id and apply the change in the same database transaction. A duplicate id returns `200` and does nothing, so a retried callback cannot create a second subscription or extend a period twice.
3. **Do not trust the order of events.** Re-read the object from the provider, or compare event timestamps, so a late `pending` event cannot undo a newer `active`.
4. **One subscription per user and plan period.** Enforce it with a unique key, not only with application checks.
5. Map the provider's status to the table above, store it, and answer `2xx` quickly. Provider retries on non-2xx are expected.

## Endpoint: start checkout (planned)

```
POST /v1/subscription/checkout
Idempotency-Key: <random id made by the client for this attempt>
```

- Creates a checkout session with the provider and returns its URL. It does not change the subscription state.
- The same `Idempotency-Key` returns the same session instead of making a second one, so a double click or a retry is safe.
- After failure or cancellation, state goes back to `none` (or `past_due`) and the user may start a new checkout. Nothing is locked.
- The client plan buttons are switched off until this exists.

## Secrets and testing

- Provider keys and the webhook secret live in the server's environment, never in this repo or the page.
- Use the provider's sandbox keys in development and CI.
- Test callbacks with mocked events signed with a throwaway test secret: valid, bad signature, duplicate id, out of order, failed then retried, cancelled, refunded.

## Status against issue #30

| Need | In this repo |
|---|---|
| States for pending, successful, failed, cancelled, refunded | Done in the client as above |
| Entitlements change only after server verification | Done in the client: only `verifySubscription()` can produce a state and tests prove storage and URL are ignored. The server side is not built |
| Verify payment with the provider | Needs a backend |
| Duplicate callbacks idempotent | Specified above. Needs a backend |
| Failure and cancellation allow safe retry | Messages and a "check again" button are done. Retrying a payment needs checkout |
| Plan, billing period, renewal, cancellation, support shown before checkout | Draft text on the subscription page. The real terms are for the project owners to confirm |
| Sandbox credentials and mocked callbacks in tests | Client tests mock `fetch`. Provider callback tests need the backend |
