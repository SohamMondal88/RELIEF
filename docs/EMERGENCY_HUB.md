# Emergency resource hub

`pages/emergency-hub.html` gathers urgent-help resources in one place, grouped by emergency type, with the audience, region, source and review status on every card. It is kept apart from everyday health content: it holds only urgent help, and a short "Not an emergency?" box sends people to the symptom checker and doctors page, which are general information.

RELIEF does not dispatch help. The page says so at the top and starts with a "Call for help" row: the main number of each supported region as a plain `tel:` link. The phone opens its dialer on a tap and the call starts only when the person presses call there. It works without sign-in and without location permission.

## Where the content lives

`assets/data/emergency-hub.json`:

| Field | Meaning |
|---|---|
| `owner` | Who is responsible for the content (see "Ownership" below) |
| `reviewCadenceDays` | How often each resource must be reviewed (180) |
| `types` | Emergency types in display order: `id` and `label` |
| `audiences` | Audiences: `id` and `label` |
| `resources` | The list. Each has `id`, `type` and `audience` (ids from the lists above) |

A resource is one of two kinds:

- **Contact:** `"contact": "IN:112"` (region code and number). The name, number, source, source link and check date are read from `REGIONAL_EMERGENCY_DATA` in `assets/js/emergency-sos.js`, the list the SOS dialog uses, so a number is never typed twice. If the number is not there, or has no source, the resource is skipped.
- **Page of RELIEF:** `title`, `summary`, `href` (a page in `pages/`, such as `firstaid.html`), `source` (text), `sourceUrl` (https link or `null`) and `lastReviewed` (`YYYY-MM-DD` or `null`).

A resource that fails its checks (unknown type or audience, duplicate id, bad link, no source) is not shown. `node --test tests/emergency-hub.test.js` fails if the shipped file has any such resource.

## Review flags

The flag comes only from `lastReviewed` (for a contact, the number's `lastVerified`) and the cadence:

| State | When | Label |
|---|---|---|
| reviewed | a real date, not in the future, within the cadence | Reviewed 2026-11-13 |
| overdue | a real date older than the cadence | Review overdue, last reviewed 2026-01-02 |
| unreviewed | no date, an impossible date or a date in the future | Not reviewed yet |

Overdue and unreviewed resources stay listed with a visible flag, because hiding an emergency number is worse than warning about it. The summary line above the list counts how many need review.

Today every resource is "Not reviewed yet": no person has recorded a review, and none is invented here.

## Ownership and review cadence

- **Owner:** the maintainers of this repository, listed in `owner` in the JSON. This is a proposal. The maintainers need to confirm who is responsible and replace the text.
- **Cadence:** every resource is reviewed at least every 180 days (`reviewCadenceDays`, copied from `docs/FACILITY_VERIFICATION_POLICY.md`; confirm it fits).
- **How to review:** open the source, check the number or page against it, then set `lastReviewed` (page of RELIEF) or `lastVerified` (contact in `emergency-sos.js`) to today's date in a pull request that says where you checked.
- **Adding a resource:** add it to `resources` with a source. Do not add a number or a claim you cannot point to a source for. Clinical content (first aid) should go through `docs/FIRST_AID_REVIEW_CHECKLIST.md` first.

## What is not here yet

There are no disaster-specific resources (flood, heat, earthquake and so on). None has been sourced and reviewed, and none is invented. The structure takes them: add an emergency type and the resources with their sources. The only disaster coverage today is that the Indian 112 service is described in the SOS data as covering disasters.

## States the page handles

Loading, the file or the numbers failing to load (an alert with a "dial from your keypad" fallback and links to the ambulance and first aid pages), an empty list ("No resources have been published yet"), a search with no match, and flagged unreviewed or overdue resources. The tests for these are in `tests/emergency-hub.test.js` and `e2e/emergency-hub.spec.js`.
