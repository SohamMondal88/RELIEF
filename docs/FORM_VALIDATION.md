# Email and phone validation

`assets/js/validators.js` holds the email and phone rules for every form. Before it, the same email expression was pasted into six scripts and each script had its own idea of a phone number, so a value could pass on one form and fail on the next.

## The rules

| | Accepted | Refused |
|---|---|---|
| Whitespace | Spaces, tabs and new lines around the value are removed before the check, and the cleaned value is what is kept | Spaces inside an address or between an address and its `@` |
| Email | One `@`; up to 254 characters in all and 64 before the `@`; dot separated pieces before the `@` (`first.last`, `first+tag`, `o'brien`, non-English letters); a domain of two or more labels of letters, digits and hyphens, the last one two or more characters and not all digits | `a@b..c`, `..a@b.co`, `a..b@c.co`, `a.@b.co`, `a@-b.co`, `a@b`, `a@b.c`, `a@b.123`, two `@`, brackets, commas and quotes before the `@` |
| Phone | Digits with spaces, dashes, dots and brackets, an optional leading `+` or `00` for the country code, 7 to 15 digits (not counting the `+` or `00`), at most 32 characters typed | Letters (`555-CALL`), a `+` anywhere but the start, brackets that are not paired or are nested, fewer than 7 or more than 15 digits |
| Optional field | Blank (or only spaces) is fine and does not block the form | A value that is filled in but wrong |

So `(415) 555-0132`, `+1 415 555 0132`, `+44 (0)20 7946 0958`, `00 44 20 7946 0958`, `033 2241 4239` and `1800-345-6789` are all phone numbers. This is a shape check, it cannot know that a number exists or belongs to the person.

API: `ReliefValidators.isEmail(value)`, `isPhone(value)`, `trim(value)` and `check(kind, value, { required })`, which returns `{ ok, value, reason }` with `reason` one of `blank`, `invalid` or `too-long`. In node (`require('./validators.js')`) it is the same module.

## Where it is used

| Form | Script | Rule |
|---|---|---|
| Contact | `contact.js` | email |
| Login and signup | `main.js` (`validateForm`) | email, now trimmed like `login.js` and `signup.js` already did |
| Blog newsletter | `blog.js` | email (it only checked for an `@` before) |
| Firebase sign in and up | `api.js` | email |
| Appointment request | `appointment-request.js` | email. The phone keeps its own rule (below) |
| Health event form | `health-events.js` | optional phone and email |
| Facility correction form | `facility-corrections.js` | optional contact (email or phone) and a proposed phone number |

The appointment form takes only Indian mobile numbers (10 digits starting 6 to 9, with `+91`, `91` or `0` in front) or a number with a `+`. It is stricter on purpose, the request is meant for an Indian hospital to call back, and `tests/form-validation.test.js` keeps `033 2241 4239` (a landline) as a refused value. It stays in `normalizePhone`.

`assets/js/facility-schema.js` still has its own phone check. It judges facility records in `assets/data/facilities.json`, not what a person types.

## Adding it to a page

Load the script before the first script that uses it:

```html
<script src="../assets/js/validators.js"></script>
```

`tests/validators.test.js` fails if a page loads one of those scripts without it. `sw.js` saves it for offline use because `pages/hospitals.html` is one of the saved pages (`CACHE_VERSION` was raised for that).

## Server side

There is no backend in this repository, so nothing here is enforced anywhere a user cannot change. The browser check is there to give a clear message early. A backend that receives these fields must repeat it for every submission: trim the value, cap its length, check the same email and phone shape, and treat an optional field that is empty as absent. It must not rely on a form having been used at all, a request can be sent directly. Related notes on what a backend has to repeat are in [FORM_PROTECTION.md](FORM_PROTECTION.md), [FACILITY_CORRECTIONS.md](FACILITY_CORRECTIONS.md) and [HEALTH_EVENTS.md](HEALTH_EVENTS.md).
