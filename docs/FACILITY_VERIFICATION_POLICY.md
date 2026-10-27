# Facility data freshness and verification

The directory should never look more certain than it is. Every record in `assets/data/facilities.json` has a review state, a source, a date and a log of who changed that state. The public page words its label from those fields and nothing else.

This is a draft policy written from what the code can enforce. Maintainers should confirm the numbers (180 days) and who may verify.

## Review states

| State | Meaning | Public badge |
|---|---|---|
| `pending` | Not checked yet, or sent back for a re-check. This is where every record starts | Not verified |
| `verified` | A named person confirmed the details against a named source on a given date | Verified |
| `stale` | Was verified, but the check is too old (see below) or a maintainer flagged it | Needs re-checking |
| `rejected` | A reviewer could not confirm the record (does not exist, wrong place, cannot be reached) | Could not be confirmed |

`stale` is partly worked out, not only stored. A record stored as `verified` is shown as `stale` once its `lastChecked` date is more than `maxAgeDays` old, with nobody editing anything (`reviewStatus()` in `assets/js/facility-utils.js`). A maintainer can also store `stale` on purpose, for example when a correction suggests a detail changed.

## Evidence rule

A record is only ever shown as Verified if all of these are true:

1. `reviewState` is `verified`
2. `source` says where the details were confirmed
3. `verifiedBy` names who confirmed them
4. `lastChecked` is a real date (`YYYY-MM-DD`) that is not in the future
5. that date is no more than `maxAgeDays` ago

If a record says `verified` but misses any of 2 to 4, the page treats it as `pending` and shows "Not verified". The data checks (`node --test`) also fail, so it cannot be merged by accident. The old boolean `verified` is kept for compatibility and must always equal `reviewState === "verified"`.

"Verified only" in the directory filter lists only records that are verified right now. Stale ones are left out.

## How old is too old

`reviewPolicy` at the top of `facilities.json`:

```json
"reviewPolicy": { "maxAgeDays": 180, "byType": {} }
```

- Default 180 days for every facility type.
- `byType` overrides it for one type, for example `{ "pharmacy": 90 }`. Nothing is overridden today. Opening hours and stock change faster than the address of a district hospital, so the maintainers may want a shorter window for clinics and pharmacies.
- A value that is not a positive whole number is ignored and the default is used.
- The age is counted in whole days (UTC dates). 180 days old is still verified, 181 is stale.

## What counts as a source

Write it so another maintainer could repeat the check, for example "District health office list, 2026 edition", "Hospital website, contact page" or "Phone call to the front desk". A source link from a person who sent a correction is a lead, not evidence (see `docs/FACILITY_CORRECTIONS.md`). A moderator or maintainer has to confirm it themselves.

`verifiedBy` is a GitHub username or a role name. It is kept in the data file and the log. The public card shows the source and the date, not the name.

## Who can verify

Anyone with merge rights on this repo can record a decision, and the change goes through a pull request like any other. Nobody can verify their own facility's record through the site: the public site has no write access to the data. Who the maintainers are is for the project owners to decide.

## Maintainer workflow

```
node scripts/facility-review.js summary
node scripts/facility-review.js list --limit 20
node scripts/facility-review.js record fac-007 --state verified --by <you> --source "District health office list" --date 2026-10-20
node scripts/facility-review.js record fac-012 --state rejected --by <you> --note "No such hospital at this address"
node scripts/facility-review.js check --base-ref origin/main
```

- `list` is the queue. Stale records come first (they carry, or carried, a trust label that has run out), then pending ones. In each group the record that was checked longest ago comes first, and never-checked comes before any date. Ties go by id so the order is the same for everyone.
- `record` writes one decision. Verifying needs `--by`, `--source` and a date (defaults to today, cannot be in the future). Stale, rejected and pending need `--by` and a `--note` saying why. It refuses to write a file that would fail the checks.
- The admin panel (`pages/admin-panel.html`, "Facility data freshness") shows the same queue and counts. It is read only on purpose: a browser cannot write the data file, and nothing there can change a state.
- Edit the details of a facility (phone, hours, address and so on) and the review state in the same pull request. If a record is `verified` and its details change, the record must get a new verification entry in that change, or be set back to `pending`. `check --base-ref` fails otherwise.

## Audit trail

Every state change appends one entry to the record's `reviewLog`:

```json
{ "at": "2026-10-27T10:00:00.000Z", "by": "maintainer-a", "from": "pending", "to": "verified",
  "date": "2026-10-20", "source": "District health office list" }
```

Rules the checks enforce (`validateRecord`, `compareRecords` in `assets/js/facility-review.js`):

- a record that is not `pending` has at least one log entry, and the last entry matches the stored state
- for `verified`, `verifiedBy`, `lastChecked` and `source` equal what the last entry says
- entries are in time order and each starts from the state the one before it ended in
- compared with the version on the target branch, the log may only grow. Editing or removing an earlier entry fails
- a review field cannot change without a new log entry

CI runs the append-only check on pull requests (`check --base-ref origin/<target branch>`). Git history is still the real record: the log makes the question "who decided this and on what evidence" answerable from the file itself.

## What this does not do

- There is no backend, so there is no live review queue, no notification when a record turns stale and no per-user login for maintainers. A stale record is found when someone looks at the list.
- The log is in a file that anyone with write access can edit. The CI check and review of the pull request are what stop that, not the file.
- `assets/js/pharmacies.js` keeps its own list in the script, not in `facilities.json`, so it is not covered. Moving it into the data file would bring it under this policy.
- No record is verified today. All 46 start as `pending` because nobody has checked them against a source yet, and this change does not invent a check.
- The labels are English only (they are drawn by `hospitals.js` like the existing badge).
