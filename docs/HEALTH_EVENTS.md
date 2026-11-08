# Health camps and community events

`pages/health-events.html` helps people in rural areas find health camps, vaccination drives, screening events and outreach programmes. Each event shows its date and time (IST), venue and district, organiser, services, who can attend, contact details and when it was last updated.

Organisers can submit an event. A submission is **never** shown as confirmed until a moderator checks it on `pages/admin-panel.html`.

## Files

| File | What it does |
|---|---|
| `assets/js/health-events.js` | Date/time validation, record cleaning, filters, past-event archiving, submission validation, rate limit, the moderation state machine and the store. No DOM, tested with `node:test` |
| `assets/js/health-events-ui.js` | Connects the list, filters and organiser form on `pages/health-events.html`, and the moderator queue on `pages/admin-panel.html` |
| `assets/data/health-events.json` | Published events used when no backend list is available. The current records are **samples** (`"sample": true`) and the page labels them |
| `assets/css/health-events.css` | Styles |
| `assets/js/api.js` | `listHealthEvents`, `submitHealthEvent`, `listHealthEventSubmissions`, `reviewHealthEventSubmission` |
| `tests/health-events.test.js` | Tests |

## Confirmed vs unverified

Every record has a `status`:

| Status | Meaning | Shown to the public |
|---|---|---|
| `confirmed` | A moderator checked it with the organiser or an official notice | Yes, with a green "Confirmed" badge |
| `pending` | Submitted by an organiser, not checked yet | Only when the visitor ticks "Also show unverified submissions", with an amber "Unverified" badge and a warning to call before travelling |
| `rejected` | A moderator turned it down | Never |

Rules that keep an unverified submission from being published as confirmed:

- `buildSubmission` always sets `status: 'pending'`. Any `status`, `verifiedBy` or `lastUpdated` in the form input is ignored, and the store never sends a status to the backend.
- `normalizeEvent` treats only the exact string `'confirmed'` as confirmed. Anything else (`'Confirmed'`, `'verified'`, a missing value) is shown as unverified. This also applies to records from the backend and the data file.
- `decide` is the only way to change a status. Confirming needs a named moderator and evidence (at least 10 characters); rejecting needs a reason. A decision is final.

## Dates and times

- The form takes a date (`DD-MM-YYYY`) and a 24 hour time (`HH:MM`) in India Standard Time. They are stored as ISO 8601 with the `+05:30` offset, so every device reads the same instant.
- Only real calendar dates are accepted (no 30 February), the event must start in the future and at most a year ahead, it must end after it starts, and it can last at most 30 days.
- Stored records must use a full ISO date-time with an offset or `Z`. A record with an invalid start, or an end before its start, is dropped instead of being shown.

## Past events

An event is past once its end time has passed (or 8 hours after its start when it has no end). Past events are moved out of the main list into a collapsed "Past events (archived)" section, most recent first, and each one carries a "Past event" badge.

## Filters

- **Location:** matches the district, venue or title, ignoring case. Suggestions come from the districts in the list.
- **Kind of event:** health camp, vaccination drive, screening event, outreach programme.
- **From / to date:** keeps events that overlap the range, so a three day drive that started yesterday still shows for today. "To" must be on or after "from"; invalid dates show an error next to the field.

The page shows a loading state while events load, an error if they cannot be loaded, and an empty state (with a clear filters button) when nothing matches.

## Where the data lives

Same rules as facility corrections (`FACILITY_CORRECTIONS.md`):

- **With the RELIEF backend:** the page uses `ReliefAPI`. This is the only place moderator permissions and rate limits can really be enforced.
- **Demo mode** (localhost, `file://`, `window.RELIEF_DEMO_MODE = true` or `<meta name="relief-demo-mode" content="true">`), and only when the backend cannot be reached: submissions and decisions are kept in this browser's localStorage under `relief_demo_health_events`, marked `demo: true`, and nothing is sent anywhere.
- **Anywhere else without a backend:** the public list comes from `assets/data/health-events.json` and the form says it cannot send right now. Nothing is stored.

`relief_health_event_submissions` holds only submission times and a fingerprint for the duplicate and rate checks. Both keys are listed in `PRIVACY_AND_DATA.md`.

## Backend contract

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health-events` | Public. Array or `{ events: [] }`. Must never include rejected submissions. Every record needs `lastUpdated` |
| POST | `/v1/health-events/submissions` | Public. Body: `title, type, startsAt, endsAt, district, venue, organiser, services, eligibility, contactPhone, contactEmail, sourceUrl`. The server sets `status: 'pending'` itself, repeats every validation above and rate-limits by IP |
| GET | `/v1/health-events/submissions?status=` | Moderators only (401/403 otherwise) |
| POST | `/v1/health-events/submissions/{id}/decision` | Moderators only. Body: `{ decision: 'approve' \| 'reject', reason, evidence }`. Takes the moderator's name from their login, not the request. Refuses a second decision |

## Adding a real event to the data file

1. Check the event with the organiser or an official notice.
2. Add it to `assets/data/health-events.json` with `status: "confirmed"`, `verifiedBy`, a `lastUpdated` timestamp with offset, and **no** `sample` flag.
3. Run `npm test`. The data-file test fails if a record is invalid or has no `lastUpdated`.
