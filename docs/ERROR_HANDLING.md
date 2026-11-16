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

### Provider lists (doctors, hospitals, pharmacies, ambulances)

These four lists use `describeDirectory` / `renderDirectory` so the three ways of having nothing to show
look different:

| Situation | State | Buttons |
|---|---|---|
| The filters match nothing | empty, `role=status`, "No ... found matching your criteria" | Clear search and filters |
| The list itself is empty | empty, `role=status`, "No ... are listed right now", says it does not mean there are none nearby | none |
| Loading the list failed, or building it threw | error, `role=alert` | Try again |

Empty and error states always include the emergency line, and the emergency buttons and SOS sit outside the list so a state never hides them. None of the texts says a provider is live, open or available.
The hospitals list loads `assets/data/facilities.json`, so it also has a real loading state. The doctor, pharmacy and ambulance lists are built from data inside their scripts, so there is nothing to wait for and they have no loading state (a spinner there would be fake). `guardList(container, build)` wraps the code that draws such a list: if it throws, the error state with Try again is shown and the failure is logged without the error text. Without JavaScript each list shows a `<noscript>` line with the emergency numbers.

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
writes, request ids and log redaction. `e2e/facility-search.spec.js` covers the facility list
(offline, 503 then success, 404).
