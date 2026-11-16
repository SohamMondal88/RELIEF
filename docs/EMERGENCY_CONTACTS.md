# Emergency contact directory

`pages/emergency-contacts.html` lists emergency numbers by region. Each number shows its source and when a person last checked it. The page does not dispatch help and never dials a number by itself: a number is a normal `tel:` link, so the phone opens its dialer only when the person taps it, and the call starts only when they press call there.

It works without sign-in and without location permission. The region is guessed from the browser language (`en-IN` gives India) and can always be changed. If the guess fails, or the person picks "My region is not listed", no number is picked for them: every region's numbers are shown, labelled by region, with a note to check their own country's official number.

## Where the numbers live

One place: `REGIONAL_EMERGENCY_DATA` in `assets/js/emergency-sos.js`. The SOS dialog and this page read the same list, so they cannot disagree. `assets/js/emergency-contacts.js` holds the checks and `assets/js/emergency-contacts-ui.js` draws the page.

Each entry in `services`:

| Field | Needed | Meaning |
|---|---|---|
| `name` | yes | What the number is for, in plain words |
| `number` | yes | Digits only, 2 to 6 long. It goes into a `tel:` link, so no spaces, `+` or extensions |
| `source` | yes | Who publishes it, written so another person can find it again |
| `sourceUrl` | no | An `https` link to the source. `null` when none is recorded yet (the page then says "no link recorded yet") |
| `scope` | yes | `national` or `local`. National numbers work country wide. A local number belongs to one state, district or city, so put the place in the name |
| `lastVerified` | no | `YYYY-MM-DD` of the day a person checked the number at its source. `null` when nobody has |

An entry that fails these checks is not shown at all. `node --test tests/emergency-contacts.test.js` fails if a published entry has no source, a bad number, an unknown scope, a link that is not https or a date that does not exist.

## Verification and stale entries

The label on each number comes only from `lastVerified`:

| State | When | Label on the page |
|---|---|---|
| verified | a real date, not in the future, at most 180 days old | Verified 2026-11-13 |
| stale | a real date older than 180 days | Needs re-checking: last verified 2026-01-02 |
| unverified | no date, a date that is not a real day, or a date in the future | Not verified yet, needs review |

Stale and unverified numbers are still listed, because hiding an emergency number is worse than showing it with a warning. The window (180 days) matches `docs/FACILITY_VERIFICATION_POLICY.md` and is `DEFAULT_MAX_AGE_DAYS` in `emergency-contacts.js`. Maintainers should confirm it.

Right now every entry is "Not verified yet". The numbers and sources were already in the SOS data, but nobody has recorded a check against them, and this change does not invent one.

## Recording a check

1. Open `sourceUrl` (or find the source named in `source`) and confirm the number and what it is for.
2. Set `lastVerified` to today's date in `emergency-sos.js` and fill in `sourceUrl` if it was `null`.
3. Open a pull request. Say in it where you checked.

To add a number, add a service to the right region with all the needed fields. Do not add a number you cannot point to a source for. To add a region, copy an existing region object (`code`, `name`, `primaryNumber`, `primaryLabel`, `primarySource`, `services`). To add a local contact, use `scope: 'local'` and put the place in the entry name.

## Review

Every number should be re-checked at least every 180 days. `grep -n "lastVerified" assets/js/emergency-sos.js` lists the dates, and the page itself shows which numbers are overdue.
