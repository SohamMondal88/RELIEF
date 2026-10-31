# Synthetic provider fixtures for tests

Tests that need a hospital, doctor, pharmacy or ambulance record take it from one shared, clearly fake file instead of writing their own (Issue #122). This page describes that file and the rules every record has to follow. It sits next to [FACILITY_DATA_CONTRACT.md](FACILITY_DATA_CONTRACT.md), which describes the real dataset.

> Everything in these fixtures is made up. It must never be shown to a visitor, copied into `assets/data/`, or described as verified healthcare information.

## Files

| File | What it is |
|---|---|
| `tests/fixtures/providers/synthetic-providers.json` | The records, in four lists: `hospitals`, `doctors`, `pharmacies`, `ambulances` |
| `tests/helpers/provider-fixtures.js` | Loads the file, hands out copies (`get(kind, id)`), checks a record (`validateProvider`) or the whole file (`validateAll`) |
| `tests/provider-fixtures.test.js` | Checks every fixture, checks that the checker rejects bad records, and checks the fixtures have not leaked into real data |

Use them like this:

```js
const fx = require('./helpers/provider-fixtures');
const doctor = fx.get('doctor', 'synthetic-doctor-001');   // a copy, safe to change
const facilities = U.normalizeFacilities(fx.hospitals);    // hospitals and pharmacies are facility-shaped
```

`tests/facility-utils.test.js` and `tests/appointment-request.test.js` already use them.

## Rules for every record

| Rule | Why |
|---|---|
| `synthetic` is `true` (and the file has `"synthetic": true` and a note saying so) | A record can always be told apart from real data |
| `id` is `synthetic-<kind>-NNN`, for example `synthetic-ambulance-002`, and unique | An id cannot be mistaken for a real record, and the test that scans the shipped data and pages for `synthetic-...-` ids can find a leak |
| `verified` is never `true`, and `source` and `lastChecked` are absent | Nothing here has a real source, so it can never show up as "Verified" |
| `phone` uses the fictional `5550` exchange, 7 to 15 digits | Never a number somebody could dial |
| `website`, when present, is `https` on `example.org` (or a subdomain), with no credentials | Never a link to a real provider |
| No email addresses and no `<` or `>` | Keeps real contact details and markup out |
| `lat` and `lng` come together or not at all, numbers in range, not `0,0` | Same coordinate rule as the real contract |
| `hours` is text up to 200 characters that says `Open 24 hours` or has times such as `9:00-17:00` (hour 0 to 23, minute 0 to 59, open is not equal to close) | Hours that a page can actually show |

## Fields by kind

Required fields are in bold. All other fields may be missing or `null`.

| Kind | Fields |
|---|---|
| `hospital` (also clinics and health centres) | **`id`**, **`synthetic`**, **`name`**, **`type`** (`hospital`, `phc`, `clinic`, `diagnostic`), **`district`**, `address`, `phone`, `hours`, `services` (list), `lat`, `lng`, `website` |
| `doctor` | **`id`**, **`synthetic`**, **`name`**, **`specialty`**, **`district`**, `facilityId` (an `id` from `hospitals`, or `null`), `phone`, `hours`, `website` |
| `pharmacy` | **`id`**, **`synthetic`**, **`name`**, **`type`** (`pharmacy`), **`district`**, `address`, `phone`, `hours`, `services` (list), `lat`, `lng`, `website` |
| `ambulance` | **`id`**, **`synthetic`**, **`name`**, **`serviceType`** (`emergency`, `non-emergency`, `both`), **`district`**, `phone`, `hours`, `responseTime` (text), `lat`, `lng`, `website` |

Hospital and pharmacy records are also run through the real facility contract (`FacilitySchema.validateFacility`), so the directory code can use them directly. Doctors and ambulances have no shared data file in the site yet (their pages use lists inside `doctors.js` and `ambulances.js`), so their shape here is a test-side description, not a site contract. If a real contract for them is added later, change this page and the checker in the same pull request.

## Adding or changing a fixture

1. Add the record to `synthetic-providers.json` with the next free number for its kind.
2. Run `node --test tests/provider-fixtures.test.js`. It tells you which rule a record breaks.
3. If a test needs a state the fixtures must not have (for example a verified record to test the "Verified" label), build it inside that test from a copy, as `tests/facility-utils.test.js` does, and say why in a comment. Do not put it in the fixture file.
4. Keep names plainly fake ("Sample", "Example", "Demo", "Placeholder"). Do not use the name of a real hospital, doctor or pharmacy.

The older facility fixtures in `tests/fixtures/facilities/` are described in [FACILITY_DATA_CONTRACT.md](FACILITY_DATA_CONTRACT.md#fixtures). They stay as they are because they exercise the facility contract itself, including a verified example.
