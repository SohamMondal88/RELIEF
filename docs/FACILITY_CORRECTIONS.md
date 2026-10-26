# Facility corrections

People can suggest a fix for a facility's opening hours, phone number, address or services. A suggestion never changes the public directory by itself. It goes into a review queue, a moderator approves or rejects it with a written reason, and an approved change is applied to `assets/data/facilities.json` by a maintainer.

This repo has no backend, so there are two ways this runs:

- **With the RELIEF backend**: the form and the moderator page talk to it through `ReliefAPI`. This is the real setup, and the only place rate limits and moderator permissions can actually be enforced. The backend is not built yet; the contract is below.
- **Demo mode**: on `localhost`, a `file://` preview, or when `window.RELIEF_DEMO_MODE = true` (or `<meta name="relief-demo-mode" content="true">`) is set, and only if the backend cannot be reached, the queue is kept in this browser's localStorage. Those records are marked `demo: true`, the pages say so, and nothing is sent anywhere. On any other host with no reachable backend, the form says it cannot send right now and stores nothing. This is the same rule the sign-in fallback uses (`assets/js/auth-mode.js`).

## Files

| File | What it does |
|---|---|
| `assets/js/facility-corrections.js` | Validation, sanitising, rate limit and duplicate check, the state machine, audit log, the store. No DOM, tested with `node:test` |
| `assets/js/facility-corrections-ui.js` | Connects the form on `pages/hospitals.html` and the moderator view on `pages/admin-panel.html` |
| `assets/js/api.js` | `submitFacilityCorrection`, `listFacilityCorrections`, `reviewFacilityCorrection` |
| `tests/facility-corrections.test.js` | Tests |

## What a person can suggest

Only these four fields, nothing else: `hours`, `phone`, `address`, `services`. A suggestion for `verified`, `source`, `lastChecked`, a review state, or any other field is refused.

The form asks for the facility, the field, the proposed value, an optional source link and an optional email or phone number (so a moderator could ask a question). It does not ask for a name, and the page stores no account id or IP address. The optional contact detail is shown only to moderators and is **deleted when they decide**.

Checks in the browser (the backend must repeat all of them):

- the facility must exist, the field must be one of the four
- text is trimmed, control characters, invisible direction marks and `<` `>` are removed, length limits apply (hours 120, phone 30, address 200, services up to 10 items of 60)
- phones need 7 to 15 digits; the source link must be a full `http(s)` address with no user name or password; contact must look like an email or a phone number
- a value that is already what the directory shows is refused
- a hidden "leave this empty" field: if a bot fills it, the suggestion is dropped
- at most 1 suggestion every 30 seconds, 3 per hour, 10 per day, and the same change (same facility, field and value) is not accepted twice within 7 days

These checks slow down a careless double click or a script. They do not stop a determined person, because anyone can clear their own browser storage or call the backend directly. Real protection has to be on the server: rate limit per IP address and per account if there is one, a CAPTCHA or similar if abuse appears, a cap on the pending queue.

## Status and audit trail

```
pending --approve (needs evidence)--> approved
pending --reject  (needs reason)----> rejected
```

A decision is final. To change it, someone files a new suggestion. The names `pending`, `approved`, `rejected` are used for corrections. They are not the facility review states (`pending`, `verified`, `stale`, `rejected`) from the verification workflow in issue #55, and approving a correction does not set any of them.

Every correction carries an append-only `history`:

```json
{
  "id": "cor_mh4k2x_a1b2c3",
  "facilityId": "fac-001",
  "facilityName": "Alpha Hospital",
  "field": "hours",
  "currentValue": "Mon to Sat 9:00 to 17:00",
  "proposedValue": "Mon to Sun 8:00 to 20:00",
  "sourceUrl": "https://example.org/notice",
  "contact": "",
  "status": "approved",
  "createdAt": "2026-10-26T10:00:00.000Z",
  "decidedAt": "2026-10-26T11:00:00.000Z",
  "decidedBy": "Meera",
  "decisionReason": null,
  "evidence": "Phoned reception on 26 Oct; hours confirmed",
  "history": [
    { "seq": 1, "at": "2026-10-26T10:00:00.000Z", "action": "submitted", "by": "public", "note": "", "evidence": "" },
    { "seq": 2, "at": "2026-10-26T11:00:00.000Z", "action": "approved", "by": "Meera", "note": "", "evidence": "Phoned reception on 26 Oct; hours confirmed" }
  ]
}
```

`currentValue` is a copy of what the directory showed when the suggestion was made. The moderator page also shows a decision log (every event, newest first).

## Moderation policy

- Approve only when you checked it yourself against something other than the suggestion: a call to the facility, an official website or notice, a visit. Write what you checked and where in the evidence box. A source link supplied by the reporter does not replace that.
- Reject, with a reason, when you cannot confirm it, the source is weak (a forum post, a social media comment), or it is spam or abuse.
- Do not approve a change to emergency numbers or hours from one unverified report. Call first.
- Approving does not publish. It adds the change to the "Approved changes for maintainers" list.

## Applying an approved change

The moderator page lists approved changes as JSON:

```json
[{ "correctionId": "...", "facilityId": "fac-001", "field": "hours",
   "from": "Mon to Sat 9:00 to 17:00", "to": "Mon to Sun 8:00 to 20:00",
   "evidence": "...", "approvedBy": "Meera", "approvedAt": "...", "applied": false }]
```

A maintainer edits `assets/data/facilities.json` by hand (or with a script), checks `from` against the current record to see if it changed in the meantime, and follows the facility verification steps (source and last-checked date) in the same commit. Nothing in the site applies these changes automatically.

## Backend contract

All three calls use the session cookie. The backend must not trust anything about who is calling that comes from the request body.

### Submit (public)

```
POST /v1/facility-corrections
{ "facilityId": "fac-001", "field": "hours", "proposedValue": "...", "sourceUrl": "", "contact": "" }
```

`services` is sent as an array of strings. The backend repeats every check above, looks up `currentValue` from its own record (it must not trust a value from the page), creates the correction as `pending`, and answers `201` with the correction (without `contact`). `422` with `{ "errors": { "proposedValue": "..." } }` for invalid input, `429` for the rate limit.

### List (moderators only)

```
GET /v1/facility-corrections?status=pending|approved|rejected
```

Returns an array, or `{ "corrections": [...] }`, of records shaped like the example above. `401` if not signed in, `403` if not a moderator.

### Decide (moderators only)

```
POST /v1/facility-corrections/{id}/decision
{ "decision": "approve" | "reject", "reason": "...", "evidence": "..." }
```

The backend takes the moderator's name from their login, not from the request. It rejects `approve` without evidence and `reject` without a reason, rejects a second decision on the same correction with `409`, appends to `history`, clears `contact`, and does **not** modify the facility record. Writing the history and the status change should happen in one transaction.

## Status against issue #27

| Need | In this repo |
|---|---|
| Correction form for hours, contact, address, services | Done, on the hospitals page |
| Queue for moderator review | Behind `ReliefAPI`; demo queue in the browser. The real queue needs a backend |
| Review status and basic change history | Done (status plus append-only `history`, decision log) |
| Rate limiting and abuse protection | Browser-side limits, duplicate check and honeypot only. Real limits need a server |
| Public users cannot directly edit verified records | Nothing in the page writes to a record, and tests check it. Enforcing that for a real database needs the backend |
| Moderators can approve or reject | Done in the admin panel, with a logged name. Moderator accounts and permission checks need a backend |
| Minimise personal information | Done: no name, optional contact, deleted on decision, no IP or account stored by the page |
| Validation and moderation tests | `tests/facility-corrections.test.js` |
