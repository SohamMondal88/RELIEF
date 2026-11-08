# Roles and permissions

RELIEF has four roles. They are enforced by Firestore security rules (`firebase/firestore.rules`), so a
direct API call that skips the site is held to the same limits as the site itself.

| Role | How you get it | What it can do |
| --- | --- | --- |
| public | Default for anyone signed in (no role document) | Read and manage only their own documents |
| volunteer | An admin sets it | Same as public, plus `isVolunteer()` in rules for volunteer-only data |
| provider | An admin sets it | Same as public, plus `isProvider()` in rules for provider-only data |
| admin | Provisioned outside the app (below) | Read and change roles, read the audit log |

Roles live in one document per user: `roles/{uid}` with `{ role, updatedBy, updatedAt }`. The helper
functions `roleOf`, `isAdmin`, `isProvider` and `isVolunteer` in the rules file are the single place
that decides who is what. New privileged collections should call them instead of checking a field on the
user's own profile, which the user can write.

## Changing a role

- Only an admin can create, update or delete a `roles/{uid}` document.
- The value must be `public`, `volunteer`, `provider` or `admin`.
- `updatedBy` must be the admin making the change and `updatedAt` must be the server time.
- An admin cannot change or remove their own role, so the last admin cannot lock everyone out by accident.

## Audit log

Each role change should be followed by an entry in `auditLog` with `actor`, `action`
(`role.set` or `role.remove`), `target` (the affected uid) and `at` (server time). The rules accept
nothing else, and entries cannot be edited or deleted. No health details go in the log.

## Creating the first administrator

No one can make themselves an admin from the app, because writing a role needs an existing admin. Create
the first one from a trusted machine:

1. Sign up normally with the account that will be the administrator and note its uid
   (Firebase console, Authentication).
2. In the Firebase console open Firestore and add the document `roles/<that uid>` with the field
   `role` set to `admin`. Console and Admin SDK writes are not subject to the security rules.
3. Sign in again. From here on, further roles are set by an admin through the app or the console.

Keep the number of admins small, and remove the console access you no longer need once the first
administrator exists.

## Checking the rules

`node --test tests/firebase-rules.test.js` checks the structure of the rules (roles, audit log, no open
writes). Behaviour against the emulator is covered in `docs/FIREBASE_SECURITY.md`.
