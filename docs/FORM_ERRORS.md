# Form errors, inline help and focus (Issue #112)

Every form that checks what a person typed shows its problems the same way, using one helper: `assets/js/form-errors.js` (`ReliefFormErrors`). Do not write a second one. Add a form by giving it the markup below and calling the helper.

## What a person gets

| When | What happens |
|---|---|
| Submit with problems | Each wrong field gets `aria-invalid="true"` and an inline message, and the field's `aria-describedby` points at that message (a hint already in `aria-describedby` is kept). A summary (`role="alert"`) lists every problem as a link to its field. |
| Where focus goes | One problem: straight to that field. Several: to the summary, whose links move focus to each field (also across steps of a multi-step form). |
| Typing in a wrong field | Only that field's message, mark and summary row go away. The summary hides when nothing is left. The typed value is never touched. |
| Leaving a field (contact form) | The field is checked and marked, without moving focus or opening the summary. |
| Submit with valid values | Nothing is marked, the summary is hidden, the form is sent. |
| The send itself fails | The contact form shows its failure message (`role="alert"`) and moves focus to it, because the failed send disables the button that had focus. The text stays in the form. A rate limit message is treated the same way. |
| The send works | The contact confirmation takes focus (the submit button it replaced is gone). |

## Markup for a field

```html
<form id="my-form" novalidate>
  <div class="error-summary" id="my-error-summary" role="alert" tabindex="-1" hidden></div>
  <label for="email">Email</label>
  <input type="email" id="email" required aria-describedby="email-error">
  <p class="field-error" id="email-error" hidden></p>
</form>
```

`novalidate` matters: without it the browser stops the submit and shows its own bubble first, which looks different on every browser and is not always announced. Keep `required` so the field still says it is required.

## Script for a form

```js
const FIELDS = { email: { focusId: 'email', errorId: 'email-error' } };
const OPTIONS = { fields: FIELDS, order: ['email'], summaryId: 'my-error-summary', title: 'Please fix the following' };

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const errors = validate(values());                // { email: 'Please enter your email' }
  if (Object.keys(errors).length) { ReliefFormErrors.applyErrors(document, errors, OPTIONS); return; }
  ReliefFormErrors.clearErrors(document, OPTIONS);
  // send it
});
ReliefFormErrors.bindFieldClearing(document, OPTIONS);   // a field's message goes away when it is edited
ReliefFormErrors.bindSummaryLinks(document, OPTIONS.summaryId);
```

- Keep the rules in a plain function that takes values and returns `{ field: message }`, so `node --test` can test them without a page. The rules for the contact form are `ReliefContactSend.validate` (`contact-send.js`), for login and signup `ReliefAuth.validateLogin` and `validateSignup` (`auth-mode.js`), for appointments `ReliefAppointmentRequest.validateRequest`, for reminders `validateReminderInput` in `reminders.js`.
- `groupId` in a field's settings marks a group (a radio `fieldset`) instead of the first control.
- A key with no field in the page (for example `form: 'Could not save'`) still reaches the summary.
- `showFieldError(doc, config, message)` and `clearFieldError(doc, key, options)` handle one field, for a check on blur.
- Hidden messages use the `hidden` attribute. Each stylesheet that has a form needs `.error-message[hidden]` or `.field-error[hidden]` set to `display: none`, `.error-summary` and `[aria-invalid="true"]` styles. `contact.css`, `auth.css`, `appointments.css` and `dashboard.css` have them.
- Server answers that are not about a field (wrong password, duplicate email) stay in `#form-message` on the login and signup pages (`role="alert"`). The field they are about is marked and focused.

## What was audited

| Form | Before | Now |
|---|---|---|
| Contact | Messages in unnamed `<span>`s, no `aria-describedby`, no `aria-invalid`, borders coloured through `style`, no summary or focus, the browser's own bubble replaced ours for empty required fields, nothing was announced. | The shared pattern above, plus focus on the failure and the confirmation. `name` and `email` got `autocomplete`. |
| Login and signup | Browser bubble for empty or malformed fields, only one message at a time (`#form-message`), the terms box and most fields had no message. | `novalidate`, every problem is listed next to its field with a summary. Server answers keep `#form-message`. |
| Appointment request | Already used the helper (Issue #65). A message stayed after the field was fixed until the next submit. | Same, and a field's message goes when it is edited. |
| Medicine reminder | Same as appointments. | Same as appointments. |
| Location box (`location-panel.js`) | The box pointed at its message but was never marked invalid. | Marked `aria-invalid` when the text is refused (too short, not a place), cleared when edited. Not marked for a denied GPS lookup or a dropped connection, since those say nothing about the text. The panel is saved offline, so it does not load the helper and does its few lines itself. |
| Facility correction form, event forms (hospitals, health events) | Already marked fields, linked messages and focused the first problem. | Not changed. |
| Newsletter box (`blog.js`), chat input, search boxes | Not in scope of #112. | Not changed. |

## Tests

- `node --test tests/form-validation.test.js` covers the helper (a fake page), the rules for the contact, login and signup forms, and the markup of every form above.
- `npx playwright test e2e/form-errors.spec.js` drives each form from the keyboard: submit empty, submit with one wrong value, correct it, submit again, with checks on focus, `aria-invalid`, the description a screen reader would read and the values kept. It also runs axe-core on the pages while the errors are showing, and checks the contact form at 375px.
