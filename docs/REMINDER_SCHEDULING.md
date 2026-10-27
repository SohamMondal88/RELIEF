# Reminder scheduling rules

How medicine reminders decide when to fire. The logic is in `assets/js/reminders.js`
and is tested in `tests/reminder-timezone.test.js`.

Reminders only repeat what the user typed. They never suggest a medicine, a dosage or a
schedule, and nothing here should be changed to do so.

## Which clock does a reminder follow?

Each reminder has a mode, chosen when it is saved:

| Mode | Meaning | Use it when |
| --- | --- | --- |
| **Device clock** (default, `local`) | "Every day at 08:00" means 08:00 on this device, wherever it is. If the user travels or the device time zone changes, the reminder follows the new local time. | Routines tied to the day (with breakfast, before bed) |
| **Fixed time zone** (`fixed`) | "Every day at 08:00 in Asia/Kolkata", whatever the device clock says. | A schedule that must stay on one clock while travelling |

Before saving, the form describes what the choice means, including the device-clock time
for a fixed zone and when the first reminder will happen.

`timeZone` on a saved reminder is the zone it was created in (device-clock mode, kept only to
show a note when the device zone later differs) or the chosen zone (fixed mode).

## When does a reminder fire?

A reminder is due when all of these are true:

1. It is **active**: not paused or completed, today is not before its start date and not after its end date. Dates are read on the same clock the reminder follows.
2. The clock it follows has **reached** the set time today (the clock time is at or past it).
3. It has not already fired for **today's date** on that clock.
4. It did not fire in the last **6 hours**.

The dashboard checks every 30 seconds. Reminders **only fire while** the dashboard is open in a tab. A reminder
for a time that passed while the tab was closed appears when the tab is next open, once.

## Saving a reminder for a time that has passed

If a reminder is saved (or its schedule edited) for a time that has already passed today, the first
reminder is **tomorrow**, not immediately. The form says "First reminder: tomorrow at 08:00".
Saving it for the current minute, or a later time, fires today. A future start date is respected.

## Daylight saving

| Situation | Behaviour |
| --- | --- |
| A time that does not exist (spring forward, 02:30 when clocks jump 02:00 to 03:00) | Fires at the first check after the gap, once |
| A time that happens twice (fall back, 01:30 twice) | Fires the first time, not again |
| Half-hour and 45-minute zones (Lord Howe, Chatham, India) | Handled the same way, through the zone's own clock |

## Travelling and changed settings

- Moving **east or west** in device-clock mode: the reminder follows the new local time.
- Moving **west across the date line** can make the local date go backwards, which would make a reminder that just fired look new. The 6 hour guard stops it repeating within 6 hours.
- If the **device clock is moved back** so a reminder "fired in the future", the guard is skipped. A repeat is safer than a missed reminder.
- An unknown or removed zone name falls back to the device zone instead of throwing.

## Validation

- Time must be `HH:MM`, start and end must be real calendar dates, an end date cannot be before the start date or already past.
- "Already past" is judged on the date of the clock the reminder follows, so a fixed zone's end date is checked in that zone.
- A start date in the past is allowed (the course is already running).
- A fixed zone must be a zone name the browser knows.

## Migration

Reminders are stored in `localStorage` under `relief_reminders_v1`. The new fields are optional, so the
key and format stay the same:

| Field | Meaning | If missing or invalid |
| --- | --- | --- |
| `scheduleMode` | `local` or `fixed` | `local` (which is how every older reminder already behaved) |
| `lastNotifiedAtMs` | When it last fired, in milliseconds | `0` |

`fixed` with an unknown zone is repaired to `local`. Loading never rewrites storage: fields are
filled in memory and written back only the next time reminders are saved, so nothing is lost if
the page is closed first. Existing reminders fire at the same moments as before.

## What this does not do

- No background or push notifications: the dashboard must be open.
- No sync between devices: reminders live in one browser.
- No dosage advice of any kind.
