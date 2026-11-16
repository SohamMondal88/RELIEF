# Emergency resource directory

`pages/emergency-directory.html` is one search box over the emergency helplines and the emergency pages of RELIEF. It is for finding something fast ("ambulance", "108", "UK"). It is not a second copy of the regional contact work: it does not group by region and does not store anything of its own.

It works without sign-in and without location permission, and it never dials: a helpline is a plain `tel:` link, so the phone opens its dialer and the call starts only when the person presses call there.

## Where the entries come from

- **Helplines.** Built at load time from `REGIONAL_EMERGENCY_DATA` in `assets/js/emergency-sos.js`, the same list the SOS dialog uses. An entry is shown only if it has a service name, a number (digits only, 2 to 6 long) and a source. Anything else is skipped, never shown with a guessed value. No number is typed anywhere in the directory code or page.
- **Pages of RELIEF.** `SITE_RESOURCES` in `assets/js/emergency-directory.js`: the SOS request, the ambulance page, first aid guides and the hospital finder. They are links with a short description, no phone number, no source and no date, and are labelled "On RELIEF".

## Source and last-checked labels

Each helpline shows its `source` (as a link when `sourceUrl` is an https address) and one of:

| Label | When |
|---|---|
| Last checked 2026-11-13 | `lastVerified` (or `lastChecked`) is a real date, not in the future, at most 180 days old |
| Last checked 2026-01-02, over 180 days ago, needs re-checking | a real date older than 180 days |
| Last checked: not recorded | no date, a date that is not a real day, or a date in the future |

Today no entry has a date, so every helpline says "not recorded". The date is only ever read from the data. To record a check, set `lastVerified: 'YYYY-MM-DD'` on the service in `emergency-sos.js` after checking the number at its source.

## Search

- Lower case, extra spaces ignored, at most 100 characters.
- Every word must appear somewhere in the title, number, region name or code, source, summary or tags.
- An exact number match comes first, then a title match, then the original order.
- An empty search lists everything. A search with no match shows "Nothing found" and says to dial the local emergency number from the phone's keypad.

## When the data is missing

If the numbers cannot be loaded (`emergency-sos.js` blocked or failing, or no usable region), the page says so in an alert and still lists and searches the pages of RELIEF. It does not show an empty page.

## Adding entries

Add a number to `emergency-sos.js` with a source. Do not add a number you cannot point to a source for. To add a page of RELIEF, add an object to `SITE_RESOURCES`.
