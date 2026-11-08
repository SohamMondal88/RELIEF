# First Aid Article Review Checklist

Use this when you add, change, translate or remove a first aid article (Issue #90). First aid text can be followed by a person who is scared and in a hurry, so a wrong or missing line can hurt someone. This page is the editorial process, the checklist to paste into your pull request, and the register that says what has actually been reviewed.

It builds on [MEDICALLY_CAUTIOUS_GUIDANCE.md](MEDICALLY_CAUTIOUS_GUIDANCE.md) (symptom checker rules and clinical review requirements) and [TRANSLATING.md](TRANSLATING.md) (how the Bengali layer works).

## 1. What this covers

- The first aid articles in `assets/js/firstaid.js` (the `firstAidGuides` list shown on `pages/firstaid.html`).
- Any translated copy of those articles.
- Any other page or chatbot answer that tells a person what to do to someone who is hurt or ill.

Contributors are not clinicians and cannot approve medical content. A pull request can show that the text follows named public sources and that this checklist was done. Only a licensed clinician can mark it clinically reviewed.

## 2. Review status and what the site may say

Every article has exactly one status in the register (section 6).

| Status | Meaning | May the site say it is reviewed? |
|---|---|---|
| `Not reviewed` | No source is recorded, or nobody has checked the text against one | No |
| `Source-checked` | An editor compared every step with the listed sources on the date shown. Not a clinician | Only as "checked against (source name) on (date)". Never "medically approved" |
| `Clinician reviewed` | A licensed clinician read the whole article and the reviewer name, role and date are in the register | Yes, with the reviewer's role and the date |

Rules that never bend:

1. Do not write "medically approved", "doctor verified", "clinically validated", "expert reviewed" or similar on a page, in a locale file or in a chatbot answer unless the register says `Clinician reviewed` for that article. `tests/first-aid-review.test.js` fails the build if such wording appears in a page or script.
2. A change to the steps, warnings or numbers of an article puts it back to `Not reviewed` until it is checked again.
3. A translation has the same status as the English article it came from, never a higher one. If the English article changes, the translation is out of date until it is redone.
4. Do not invent facts. No doses, drug names, quantities, times or techniques that are not in a source you can link to. If you are not sure, leave the line out and say so in the pull request.

## 3. The process

1. **Open an issue or pick one.** Say which article and what changes.
2. **Collect sources** (checklist A). Write them in the pull request before writing any steps.
3. **Draft in your own words** from the sources. Do not paste long text from a publisher.
4. **Go through the checklist** (section 4) and tick only what you really checked. Leave a box unticked and explain it if you could not.
5. **Update the register** (section 6): sources, status, dates. A new article needs a new row, a deleted one loses its row. The unit test checks this.
6. **Translation:** if the change needs Bengali, follow checklist E. The first aid steps should only be translated by someone qualified to review them.
7. **Ask for clinician review.** Name what is waiting for review in the pull request. The maintainer decides who reviews. Until a clinician signs off, the status stays `Not reviewed` or `Source-checked`.
8. **After merge,** the next review date is the review date plus at most 6 months (the same limit as the reference table in MEDICALLY_CAUTIOUS_GUIDANCE.md). When the date has passed or a source changes, review again.

## 4. Checklist (copy into the pull request)

### A. Authoritative sources
- [ ] At least one source from a national or international health authority, a resuscitation council or a recognised first aid body (for example a ministry of health, WHO, Red Cross or Red Crescent, St John Ambulance). Not a forum, a blog, a video or generated text.
- [ ] Each source is listed in the register with its publisher, URL, the date you opened it and the date the source says it was last updated.
- [ ] Every step, warning and number in the article can be found in a listed source.
- [ ] The link opens and belongs to the publisher's own domain.
- [ ] If sources from different countries disagree, the article says which region it follows, or does not state the disputed detail.
- [ ] Nothing was added that no source says (no dose, drug name, amount, time or technique).

### B. Red flags
- [ ] The article says when to stop home care and get emergency help, using the signs the source lists.
- [ ] For time critical topics (not breathing, choking, severe bleeding, severe burns, poisoning, severe allergic reaction) the "call emergency services" warning is before the steps, not after them.
- [ ] The article says the list of warning signs is not complete, and that feeling very unwell or getting worse is a reason to call.
- [ ] No step tells the person to wait, "see how it goes" or drive themselves when a source says to call for help.
- [ ] The article does not say it can diagnose or rule out an emergency.

### C. Emergency escalation
- [ ] The emergency number text matches the rest of the site (112 and 108 are used on the hospitals page; see MEDICALLY_CAUTIOUS_GUIDANCE.md section 3.3 for the multi-region wording). Do not name one country's number as the only one.
- [ ] The page works without signing in and without sharing location. Do not add a login, location or consent step before an emergency instruction.
- [ ] The article does not suggest that RELIEF will call anyone for the person. The reader makes the call.
- [ ] If the emergency number text on the page is changed, the Bengali text keeps the same numbers.

### D. Plain language
- [ ] One action per step, starting with a verb ("Press", "Cool the burn"), short sentences.
- [ ] No unexplained medical terms. If one is needed, explain it in the same step.
- [ ] Numbers come with units and ranges taken from the source (for example minutes, centimetres or inches as the source gives them).
- [ ] "Do" and "Do not" are written out. Warnings are not carried by colour or an icon alone.
- [ ] Someone who is not a health worker read it aloud and could follow it.

### E. Translation accuracy
- [ ] Translated by, or checked by, a person who can judge the medical meaning in both languages. Machine translation alone is not enough.
- [ ] Every warning and every "do not" is still a warning and still a negation. Check these first.
- [ ] Numbers, units and emergency numbers are the same as in English (digits can be written in Bengali numerals). `tests/first-aid-review.test.js` checks the emergency numbers in `en.json` against `bn.json`.
- [ ] The order of steps is unchanged. Nothing was dropped or softened to make it shorter.
- [ ] If the English article changes later, the translation is changed in the same pull request or marked out of date in the register.
- [ ] A second native speaker looked at the warnings (see TRANSLATING.md).

### F. Review dates and claims
- [ ] The register has a row for the article, with the date this change was checked and the next review date (at most 6 months away).
- [ ] The status in the register is what really happened. Nothing on any page says more than the status allows (section 2).
- [ ] If a clinician reviewed it: the register has their name, role and the date, and they saw the final text, not an earlier draft.

## 5. Reviewer sign-off (for the clinician)

Paste this in the pull request and have the reviewer answer in their own words. Do not ask a reviewer to confirm anything on their behalf.

```
Article:
Version / commit reviewed:
Reviewer name and role:
Date:
Any step or warning that is wrong, missing or unclear:
Anything that should be removed:
Is the escalation advice right for the regions the page names:
Next review due:
```

## 6. Article register

Keep one row for every article in `firstAidGuides` in `assets/js/firstaid.js`, with the title exactly as it appears there. `tests/first-aid-review.test.js` fails if an article has no row, a row has no article, a status is not one of the three above, or a `Source-checked` or `Clinician reviewed` row is missing its source link, date or (for clinician review) reviewer.

At the time of writing none of the articles names a source or has a review date in the code, so all are `Not reviewed`. That is the honest starting point, not a verdict on the text.

| Article | Sources | Status | Checked on | Reviewer | Next review due |
|---|---|---|---|---|---|
| How to Perform CPR | none recorded | Not reviewed | | | |
| Treating Burns | none recorded | Not reviewed | | | |
| First Aid for Choking | none recorded | Not reviewed | | | |
| Treating Cuts and Scrapes | none recorded | Not reviewed | | | |
| Treating Fractures | none recorded | Not reviewed | | | |

How to fill a row once work is done:

- `Sources`: Markdown links, for example `[Publisher, title](https://...)`.
- `Checked on`: `YYYY-MM-DD`.
- `Reviewer`: `Name, role` for `Clinician reviewed`. Leave empty otherwise.
- `Next review due`: `YYYY-MM-DD`, at most 6 months after the check.

## 7. Related

- [MEDICALLY_CAUTIOUS_GUIDANCE.md](MEDICALLY_CAUTIOUS_GUIDANCE.md): symptom checker principles, red flag list, reference table, clinical review requirements.
- [TRANSLATING.md](TRANSLATING.md): language layer and how to add strings.
- `tests/first-aid-review.test.js` (run with `node --test`): the register matches the articles, no page claims medical approval, emergency numbers survive translation.
