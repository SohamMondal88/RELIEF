/**
 * Relief Healthcare Platform - Reminder notification preferences
 *
 * Keeps two things apart:
 *   - the user's PREFERENCE in RELIEF (do they want browser notifications, and with what detail)
 *   - the browser's PERMISSION (default, granted, denied, or no support at all)
 *
 * A browser notification is shown only when the user turned it on in RELIEF AND the browser allows
 * it. Reminders always appear in the page itself, so nothing depends on notifications working.
 *
 * Notifications can appear on a locked screen, so by default they say only that a reminder is
 * due. Medicine names are shown only if the user opts in. Notes ("instructions") never go into a
 * notification.
 *
 * Pure functions that take the Notification API and storage as parameters, so they run under
 * node:test. Implements Issue #63: Add consent-based reminder notification preferences.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ReliefNotificationPrefs = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PREFS_KEY = 'relief_notification_prefs_v1';
  const NOTIFICATION_TAG = 'relief-reminders';

  const DEFAULT_PREFS = Object.freeze({ browser: false, showDetails: false });

  /** What to tell the user before the browser asks. Shown on the page, not only after a click. */
  const EXPLANATION = 'If you turn this on, your browser will ask for permission. RELIEF then shows a notification when a reminder is due, even if you are on another tab. ' +
    'Notifications can appear on a locked screen, so by default they only say a reminder is due. ' +
    'Reminders always appear on this page too, so you will not miss them if you leave this off.';

  const DETAILS_WARNING = 'Show medicine names in notifications. They can be read by anyone who can see your screen.';

  // ---------- permission ----------

  /** 'unsupported' | 'default' | 'granted' | 'denied'. Pass window.Notification. */
  function getPermission(NotificationApi) {
    if (!NotificationApi || typeof NotificationApi.permission !== 'string') return 'unsupported';
    const value = NotificationApi.permission;
    return value === 'granted' || value === 'denied' || value === 'default' ? value : 'default';
  }

  // ---------- preferences ----------

  function normalizePrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      browser: src.browser === true,
      showDetails: src.showDetails === true
    };
  }

  function loadPrefs(storage) {
    try {
      const raw = storage && storage.getItem(PREFS_KEY);
      return normalizePrefs(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return normalizePrefs(null);
    }
  }

  /** Returns true when saved, false when the browser refused (private mode, quota). */
  function savePrefs(storage, prefs) {
    try {
      storage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(prefs)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- what will actually happen ----------

  /**
   * Combines the preference and the permission into one answer for the page.
   *
   * state:
   *   off               browser notifications are not wanted (in-page reminders only)
   *   needs-permission  wanted, but the browser has not been asked yet
   *   active            wanted and allowed
   *   blocked           wanted, but the browser has denied them (in-page reminders only)
   *   unsupported       this browser has no notifications (in-page reminders only)
   *
   * `browser` is true only for "active". In-page reminders always happen.
   */
  function getPlan(prefs, permission) {
    const p = normalizePrefs(prefs);
    if (permission === 'unsupported') {
      return { state: 'unsupported', browser: false, inApp: true, message: 'This browser does not support notifications, so reminders show on this page instead.' };
    }
    if (!p.browser) {
      let note = '';
      if (permission === 'granted') note = ' Your browser still allows RELIEF to send them, so you can turn this back on at any time.';
      if (permission === 'denied') note = ' Your browser is also blocking notifications for this site. To use them, allow them for this site in your browser settings first.';
      return { state: 'off', browser: false, inApp: true, message: 'Browser notifications are off. Reminders show on this page.' + note };
    }
    if (permission === 'denied') {
      return { state: 'blocked', browser: false, inApp: true, message: 'Your browser is blocking notifications, so reminders show on this page instead. To use notifications again, allow them for this site in your browser settings.' };
    }
    if (permission === 'default') {
      return { state: 'needs-permission', browser: false, inApp: true, message: 'Notifications are turned on here, but your browser has not been asked yet. Reminders show on this page until you allow them.' };
    }
    return {
      state: 'active',
      browser: true,
      inApp: true,
      message: p.showDetails
        ? 'Browser notifications are on and show medicine names. Reminders also show on this page.'
        : 'Browser notifications are on and say only that a reminder is due. Reminders also show on this page.'
    };
  }

  // ---------- changing preferences ----------

  /**
   * The user pressed "Turn on browser notifications". Asks the browser only when it can still
   * answer, and records the preference as ON only if the browser agrees.
   * Resolves { prefs, permission, plan, asked }. Never rejects.
   */
  async function enableBrowserNotifications(NotificationApi, storage) {
    const before = loadPrefs(storage);
    let permission = getPermission(NotificationApi);
    let asked = false;

    if (permission === 'default' && typeof NotificationApi.requestPermission === 'function') {
      asked = true;
      try {
        // Older browsers use a callback and return nothing, newer ones return a promise.
        const result = await new Promise(function (resolve) {
          const returned = NotificationApi.requestPermission(resolve);
          if (returned && typeof returned.then === 'function') returned.then(resolve, function () { resolve(undefined); });
        });
        permission = result === 'granted' || result === 'denied' ? result : getPermission(NotificationApi);
      } catch (e) {
        permission = getPermission(NotificationApi);
      }
    }

    const prefs = Object.assign({}, before, { browser: permission === 'granted' });
    savePrefs(storage, prefs);
    return { prefs: prefs, permission: permission, plan: getPlan(prefs, permission), asked: asked };
  }

  /** The user turned notifications off in RELIEF. Does not touch the browser permission. */
  function disableBrowserNotifications(NotificationApi, storage) {
    const prefs = Object.assign({}, loadPrefs(storage), { browser: false });
    savePrefs(storage, prefs);
    const permission = getPermission(NotificationApi);
    return { prefs: prefs, permission: permission, plan: getPlan(prefs, permission) };
  }

  function setShowDetails(NotificationApi, storage, show) {
    const prefs = Object.assign({}, loadPrefs(storage), { showDetails: show === true });
    savePrefs(storage, prefs);
    const permission = getPermission(NotificationApi);
    return { prefs: prefs, permission: permission, plan: getPlan(prefs, permission) };
  }

  // ---------- content ----------

  /**
   * Text for the browser notification. Generic unless the user opted into names.
   * Notes are never included. Several due reminders become one notification.
   */
  function buildNotificationContent(dueReminders, prefs) {
    const list = Array.isArray(dueReminders) ? dueReminders : [];
    const p = normalizePrefs(prefs);
    const count = list.length;

    if (!p.showDetails || count === 0) {
      return {
        title: 'RELIEF reminder',
        body: count === 1 ? 'You have a reminder due. Open RELIEF to see it.' : 'You have ' + count + ' reminders due. Open RELIEF to see them.',
        tag: NOTIFICATION_TAG
      };
    }

    const names = list.map(function (r) { return r.medicine + ' (' + r.time + ')'; });
    return {
      title: 'RELIEF reminder',
      body: count === 1 ? 'Reminder: ' + names[0] : 'Reminders: ' + names.join(', '),
      tag: NOTIFICATION_TAG
    };
  }

  /** Full text for the in-page banner (the page is open, so details are fine there). */
  function buildInAppMessage(reminder) {
    const note = reminder.instructions ? ' Note: ' + reminder.instructions : '';
    return 'Reminder: ' + reminder.medicine + ' (set for ' + reminder.time + ').' + note;
  }

  // ---------- delivery ----------

  /**
   * Delivers due reminders. The in-page messages are always returned. A browser notification is
   * sent only when the plan says "active". A failure to notify never throws and never loses the
   * in-page message.
   *
   * @returns {{inApp: string[], browser: 'sent'|'skipped'|'failed', plan: Object}}
   */
  function deliver(dueReminders, NotificationApi, prefs) {
    const list = Array.isArray(dueReminders) ? dueReminders : [];
    const plan = getPlan(prefs, getPermission(NotificationApi));
    const inApp = list.map(buildInAppMessage);

    if (list.length === 0 || !plan.browser) {
      return { inApp: inApp, browser: 'skipped', plan: plan };
    }

    const content = buildNotificationContent(list, prefs);
    try {
      new NotificationApi(content.title, { body: content.body, tag: content.tag });
      return { inApp: inApp, browser: 'sent', plan: plan };
    } catch (e) {
      return { inApp: inApp, browser: 'failed', plan: plan };
    }
  }

  return {
    PREFS_KEY,
    NOTIFICATION_TAG,
    DEFAULT_PREFS,
    EXPLANATION,
    DETAILS_WARNING,
    getPermission,
    normalizePrefs,
    loadPrefs,
    savePrefs,
    getPlan,
    enableBrowserNotifications,
    disableBrowserNotifications,
    setShowDetails,
    buildNotificationContent,
    buildInAppMessage,
    deliver
  };
});
