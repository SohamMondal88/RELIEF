# Appointment request status

What happens to an appointment request after it is sent, who can change it, and how the rules
are enforced. The page logic is `assets/js/appointment-status.js`, the list is
`assets/js/appointment-status-ui.js`, and the server rules are in `firebase/firestore.rules`.

A request is **not a booking**. Nothing is shown as confirmed until the provider confirms it.

## Statuses

| Status | Meaning | Shown to the patient as |
| --- | --- | --- |
| `submitted` | Sent, nobody has looked at it | Submitted: not a booking, nothing is confirmed |
| `under_review` | The provider is looking at it | Under review: not confirmed yet |
| `confirmed` | The provider accepted it | Confirmed by provider |
| `declined` | The provider cannot accept it | Declined by provider (final) |
| `cancelled` | Cancelled by the patient or the provider | Cancelled (final) |

Older requests stored as `requested` are read as `submitted`. A status the code does not recognise is
shown as "Status unknown, contact the provider" and is never treated as confirmed.

## Who can change what

| From | Patient can | Provider can |
| --- | --- | --- |
| `submitted` | cancel | start review (`under_review`), decline |
| `under_review` | cancel | confirm, decline, cancel |
| `confirmed` | cancel | cancel |
| `declined`, `cancelled` | nothing | nothing |

A request cannot be confirmed without passing through review. `declined` and `cancelled` can never be
reopened: send a new request instead.

## Enforced on the server

The browser cannot be trusted to follow this table, so `firebase/firestore.rules` checks every update:

- The **patient** (the owner of the request) may change only `status` to `cancelled` and `cancelledAt` (the server time), and only from `submitted`, `under_review` or `confirmed`.
- A **provider** is a signed-in account whose token carries a `providerId` claim (set with the Firebase Admin SDK). It may read and update only requests whose `doctorId` equals its `providerId`, may change only `status` and `statusUpdatedAt` (server time), and only along the allowed path above.
- Creating a request requires `status == 'submitted'`, so a request cannot be created already confirmed.
- No one else can read or change it.

`tests/firebase-rules.test.js` checks that the rules and `appointment-status.js` describe the same table, and
`firebase/emulator/` runs the rules against the Firebase emulator (see [FIREBASE_SECURITY.md](FIREBASE_SECURITY.md)).

## Duplicates

- On the page, a second request for the same doctor, date and time window by the same email or phone is refused while the first is `submitted`, `under_review` or `confirmed`. After it is `cancelled` or `declined` a new one can be sent. A second tap on the button while sending is ignored.
- On the server, the request's own reference is the **document id** (`appointments/{reference}`). Sending the same request twice, for example a retry after a dropped connection, finds the document already there and is refused instead of creating a second booking.

## Reference

Each request has a random reference such as `RQ-7K3M-9P2X`. It contains no name, email, phone number,
date or doctor, so it is safe to quote when contacting a provider. It avoids characters that are easy to
confuse (0/O, 1/I).

## Cancelling

Under "Your appointment requests" each open request has a **Cancel request** button. It asks first ("Cancel
request RQ-…?", **Yes, cancel request** / **Keep request**, Escape closes the question). The result is announced
on the page. The list shows the reference, doctor, preferred date and window and status, never the email,
phone number or notes.

This static site cannot send anything to a provider yet. Cancelling here changes this device only, and the
page says so: if the patient has already spoken to the provider, they should tell them directly.

## How to contact the provider

The page explains that the provider confirms the date and time by the email or phone number the patient
gave, and links to the doctors page for the provider's own contact details. The reference is what to quote.

## What this does not do

- It does not send requests, reminders or status changes anywhere: there is no backend yet. `applyProviderUpdate` and the rules are ready for when there is one.
- Status changes made by a provider will appear on the page only once the page reads them from the server.
