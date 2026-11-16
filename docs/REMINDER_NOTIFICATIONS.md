# Reminder notifications

How reminders reach the user. The logic is in `assets/js/notification-prefs.js` and is tested in
`tests/notification-prefs.test.js`.

## Two separate things

| | Who decides | Where it lives |
| --- | --- | --- |
| **Preference**: does the user want browser notifications, and may they show medicine names? | The user, in the dashboard | `localStorage` key `relief_notification_prefs_v1` |
| **Permission**: may this site show notifications at all? | The browser | Browser site settings |

A browser notification is shown only when **both** say yes. Everything is **off by default**.

Reminders **always** appear in the banner on the dashboard, whatever the choices or permission are,
so nothing depends on notifications working. Reminders can be added, edited, paused and completed in
every state.

## What the user sees

| State | Meaning | What the dashboard offers |
| --- | --- | --- |
| off | The user does not want browser notifications | "Turn on browser notifications" |
| needs permission | Wanted, but the browser has not been asked | "Ask my browser for permission", "Turn off" |
| active | Wanted and allowed | "Turn off browser notifications" |
| blocked | Wanted, but the browser denies them (for example changed later in site settings) | An explanation of how to allow them again, "Turn off" |
| unsupported | This browser has no notifications | An explanation. Reminders show on the page |

An explanation is on the page before anything is requested. The browser's own prompt appears **only
after the user presses the button**, never when the page loads.

If the browser says no, or the prompt is dismissed, the preference is **not** switched on.

## What the dashboard says about permission and delivery

Under the explanation, the Notifications panel always shows two things. They come from `describeStatus()` in `notification-prefs.js` and are checked in `tests/notification-prefs.test.js` and `e2e/reminders.spec.js`.

1. **A status line** with the browser permission and whether RELIEF will send browser notifications: `Browser permission: <label>. Browser notifications from RELIEF: on|off.`

| Browser says | Label shown | Can RELIEF notify? |
| --- | --- | --- |
| No notification support | Not supported by this browser | No |
| Not granted (`default`) | Not granted | No, until the user presses the button and allows it |
| `denied` | Denied | No |
| `granted` | Allowed | Only if the user has also turned them on in RELIEF |

2. **A delivery note.** When notifications are on it says RELIEF has no server and sends no push messages, so a reminder only appears while the dashboard is open in a browser tab on this device, that Do Not Disturb and similar settings can still hide a notification, and not to rely on RELIEF as the only reminder. In every other state it says no browser notification will be sent and the reminder appears on the page only while the dashboard is open. Nothing on the page promises that a reminder will arrive.

If the browser allows notifications but refuses to create one (some mobile browsers only allow notifications from a service worker), the banner adds a line saying the reminder appears only on this page. The status line is refreshed when the tab gets focus back, so a change made in the browser's site settings shows up.

## Turning off

"Turn off browser notifications" stops notifications immediately, even if the browser still allows
them. A web page cannot withdraw a browser permission, so the page says so and the permission can
be removed in the browser's site settings. Turning notifications back on does not ask again while the
browser still allows them.

## What a notification says

A notification can appear on a locked screen, so by default it says only:

> **RELIEF reminder** — You have a reminder due. Open RELIEF to see it.

If the user ticks "Show medicine names in notifications", it shows names and times. Notes the user
typed for themselves are **never** put in a notification. Several due reminders become **one**
notification.

The banner on the page shows the full reminder including the note, because the page is already open.

## What this does not do

- No push messages: notifications and banners appear only while the dashboard is open in a tab.
- No dosage advice or schedule suggestions of any kind.
- No account or server: choices stay in this browser and are removed by "Delete my account and data".
