# Facility data contract

Every record in `assets/data/facilities.json` must follow this contract. It is checked by
`assets/js/facility-schema.js` when the hospitals page loads, and by
`tests/facility-contract.test.js` in CI (`node --test`).

Current version: **1**

## Fields

| Field | Required | Type | Rules |
| --- | --- | --- | --- |
| `id` | yes | text | Unique across the file, 1 to 64 characters, no `<` or `>` |
| `name` | yes | text | Not empty, up to 200 characters, no `<` or `>` |
| `type` | yes | text | Usually one of `hospital`, `phc`, `clinic`, `pharmacy`, `diagnostic`. Any other value is accepted with a warning |
| `district` | yes | text | Not empty, up to 100 characters |
| `address` | no | text or `null` | Up to 300 characters |
| `phone` | no | text or `null` | 7 to 15 digits; only digits, spaces, `+`, `-`, `(`, `)`, `.` |
| `hours` | no | text or `null` | Up to 200 characters |
| `services` | no | list of text | Up to 40 items, each 1 to 80 characters |
| `lat`, `lng` | no | numbers | Give both or neither. Latitude -90 to 90, longitude -180 to 180. `0,0` is rejected. A point outside West Bengal is accepted with a warning |
| `verified` | no | `true` / `false` | `true` needs `source` and `lastChecked` |
| `source` | no | text or `null` | Where the information came from, up to 300 characters |
| `lastChecked` | no | `YYYY-MM-DD` | A real date, not in the future |

Missing, `null` and absent optional fields are all fine. The directory shows "Not verified",
omits unknown contact details and sorts facilities without coordinates last.

The file itself is either `{ "schemaVersion": 1, "facilities": [ ... ] }` or a bare list.

## What happens to a bad record

On the hospitals page each record is checked before it is used:

- A record that breaks a rule is **quarantined**: it is left out of search results and the browser console lists its id and the reasons. The rest of the directory loads normally.
- A repeated `id` quarantines the later record.
- If the file itself is unusable (not a list, or a newer schema version than the site understands) the page shows its normal "could not be loaded" state with a retry button.
- An unknown `type` is shown, filterable by its own text, and reported as a warning.

In CI the real dataset must have **no** quarantined records.

## Changing the contract

| Change | Version | What to do |
| --- | --- | --- |
| Add an optional field | unchanged | Add it to `OPTIONAL_FIELDS` in `facility-schema.js`, to the table above and to the changelog |
| Allow a new `type` | unchanged | Add it to `KNOWN_TYPES` and to `FACILITY_TYPES` in `facility-utils.js` |
| Make a field required, rename or remove a field, tighten a rule that existing data may break | **bump** | Increase `SCHEMA_VERSION`, update `schemaVersion` in the data file and this page, migrate the data in the same pull request |

A data file with a higher `schemaVersion` than the code is refused, so an older site never reads a
format it does not understand.

## Fixtures

`tests/fixtures/facilities/` holds fictional records (made-up names, `5550` numbers and
`example.org` links). Do not put real people or real private numbers there.

- `valid-realistic.json` has one of every type, a record with only required fields, and an unknown type
- `invalid-records.json` lists broken records with the error each must produce

Shared fake hospital, doctor, pharmacy and ambulance records for other tests live in `tests/fixtures/providers/`, see [PROVIDER_TEST_FIXTURES.md](PROVIDER_TEST_FIXTURES.md).

To cover a new rule, add a case to `invalid-records.json`.

## Changelog

- **1**: first version. Required `id`, `name`, `type`, `district`; optional contact, location and verification fields.
