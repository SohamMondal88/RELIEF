# Error handling and retries

All failed requests go through `assets/js/request-resilience.js` (`ReliefResilience`).
`api.js` uses it for every RELIEF backend call; `hospitals.js` uses it for the facility list.

## What users see

| Failure | Title | Recovery |
| --- | --- | --- |
| Offline (`navigator.onLine === false`) | You are offline | Try again |
| Timeout (8 s backend, 10 s facility list) | This is taking too long | Try again |
| 401 | Please sign in | Sign in link |
| 403 | Not allowed | Contact support |
| 429 | Too many requests | Wait, then try again |
| Other 4xx | We could not accept that | Fix input (no retry button: it cannot succeed) |
| 5xx / unreachable | Something went wrong on our side | Try again |

Every screen uses the same four states (`renderState`): **loading** (`role=status`), **empty**,
**success** and **error** (`role=alert`). Error text is never taken from the server. Pages that
people may open in a health emergency (facility list) add "If this is an emergency, call your local
emergency number now."

## Retries

* **Reads** (GET): up to 2 retries on timeouts, network errors, 5xx and a `Retry-After` of 5 s or less,
  with exponential backoff and jitter. 4xx (except 408/429) are never retried.
* **Writes** (POST/PUT/PATCH/DELETE): never retried automatically once the request may have reached the
  server. They are retried only if the request never left the browser (offline).
* Every write sends an `Idempotency-Key` header. If the first attempt fails, the error carries
  `error.idempotencyKey`; a user-initiated "Try again" must pass it back
  (`submitFacilityCorrection(data, { idempotencyKey })`). Facility corrections do this per suggestion.
  **Backend requirement:** to make a repeat truly safe, the backend must treat a repeated
  `Idempotency-Key` as the same submission, and its CORS config must allow the header.

## Request IDs

If the backend sends `X-Request-Id` (or `X-Correlation-Id`) the id is attached to the error as
`requestId` and shown to the user as "Reference: ..." so support can find the request. Cross-origin
backends must list the header in `Access-Control-Expose-Headers`. Ids are only kept if they are short and
alphanumeric; anything else (for example a token in a header by mistake) is dropped.

## Local files and lookups: `fetchJson`

Reads that do not go through the RELIEF backend (a data file on this site, the place lookup, the
OpenStreetMap search helpers in `api.js`) use `ReliefResilience.fetchJson(url, options)`, so none of them can
wait for ever. It needs `request-resilience.js` on the page, loaded before the script that uses it.

| What happened | `error.reason` | `classify()` kind | Page should |
| --- | --- | --- | --- |
| Offline (nothing is sent) | `offline` | offline | message, Try again |
| No answer within `timeoutMs` (10 s, the place lookup uses 8 s) | `timeout` | timeout | message, Try again |
| HTTP 4xx / 5xx | none, `status` is set | rejected, server, rate-limited ... | message, Try again only if retryable |
| Answer is not JSON | `bad-answer` | unavailable | message, Try again |
| Blank body, 204 or `null` | `empty` | unavailable | message, Try again |
| Request could not be made (blocked, dropped) | `network` | unavailable | message, Try again |
| The caller cancelled it | `aborted` | `isAborted(error)` is true | show nothing: a newer request replaced it |

An empty list (`[]`) is a valid answer, not an error: the page says "no results".

Options: `timeoutMs`, `signal` (an `AbortSignal` from the caller), `init` (extra `fetch` options) and `fetch`
(tests pass a fake). `createRequestSlot()` gives "latest request wins": `slot.begin()` aborts the previous
request and returns `{ signal, isCurrent(), done() }`; a late answer checks `isCurrent()` before it touches the page.

Where it is used: the health events list (`health-events-ui.js`), the admin facility freshness list
(`facility-review-ui.js`), the place lookup (`location-service.js`, `resolveManualLocation(text, { signal, timeoutMs })`)
and `searchDoctors`, `searchHospitals`, `searchPharmacies` in `api.js`. Both lists end a timeout in a message and a
Try again button. The place lookup keeps the typed text, so pressing Set location again is the retry.

## Logging

`logError` records time, context, kind, HTTP status, attempts, request id and the URL **path**.
It never records request or response bodies, headers, query strings, user input or server error text.
`redact()` additionally strips passwords, tokens, emails, phone numbers and health-related keys from
any extra fields. `ReliefResilience.diagnosticsText()` returns the last 20 entries for pasting to support.

## Non-critical features

`degrade(name, fn, { fallbackValue, onFallback })` keeps the page working when an extra fails. The
hospitals page keeps the list usable if the map library does not load or throws.

## Tests

`tests/request-resilience.test.js` covers timeout, offline, 4xx, 5xx, 429/Retry-After, duplicate-safe
writes, request ids and log redaction. `tests/fetch-json.test.js` covers `fetchJson` (timeout, abort, offline,
500, 404, malformed JSON, empty), `createRequestSlot`, the place lookup and the search helpers.
`e2e/request-timeouts.spec.js` and the place lookup test in `e2e/network-resilience.spec.js` cover a request that never answers. `e2e/facility-search.spec.js` covers the facility list
(offline, 503 then success, 404).
