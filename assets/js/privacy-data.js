/**
 * Relief - privacy data inventory and account deletion (Issue #29)
 *
 * Pure logic, no DOM access, so it can be tested with node:test.
 *
 * RELIEF has no server of its own. Everything it remembers lives in this
 * browser's localStorage. INVENTORY lists every key the code writes; a test
 * fails if a script starts using a new key that is not listed here, so
 * docs/PRIVACY_AND_DATA.md and the deletion below cannot silently fall behind.
 *
 * Deletion has two separate parts and the result reports each one honestly:
 *   1. local: remove every inventory key and every "relief_" key from storage
 *   2. server: ask ReliefAPI.deleteAccount() to delete the signed-in account.
 *      If the sign-in service is not available the result says so. It never
 *      claims a server-side deletion that did not happen.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefPrivacy = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY_PREFIX = 'relief_';
  var SERVER_TIMEOUT_MS = 10000;

  // One entry per localStorage key the code writes. "personal" means it can hold
  // a name, contact detail, location or health related text.
  var INVENTORY = [
    {
      key: 'relief_demo_users',
      label: 'Demo accounts',
      category: 'account',
      personal: true,
      holds: 'Name, email, a random salt and a PBKDF2 password hash, creation time.',
      retention: 'Until deleted. Only written in demo mode (localhost, file:// or an explicit demo flag).'
    },
    {
      key: 'relief_users',
      label: 'Old demo accounts (legacy)',
      category: 'account',
      personal: true,
      holds: 'Older builds stored email and a plain text password here.',
      retention: 'Removed automatically on the next login or signup. Included in deletion in case it is still there.'
    },
    {
      key: 'relief_auth_sessions',
      label: 'Sign-in sessions',
      category: 'account',
      personal: true,
      holds: 'Session token, the signed-in user (id, name, email), device type (mobile or desktop), timestamps.',
      retention: 'Each session expires 30 days after sign-in; at most the 10 newest are kept. Logout clears all of them.'
    },
    {
      key: 'relief_reminders_v1',
      label: 'Medicine reminders',
      category: 'health',
      personal: true,
      holds: 'Medicine name or label, your note, daily time, start and end dates, status.',
      retention: 'Until you remove the reminder or delete your data. The dashboard also writes an empty list when it opens.'
    },
    {
      key: 'relief_history_v1',
      label: 'Dashboard health timeline',
      category: 'health',
      personal: true,
      holds: 'Timeline entries such as "Medication reminder created" with the medicine name and time.',
      retention: 'Until you delete your data. The dashboard seeds two sample entries the first time it opens.'
    },
    {
      key: 'relief_appointment_requests',
      label: 'Appointment requests',
      category: 'health',
      personal: true,
      holds: 'Your name, email, phone, optional notes, chosen doctor, preferred date and time window, consent flag.',
      retention: 'Until you delete your data. Only the newest 50 requests are kept. Nothing is sent to the doctor.'
    },
    {
      key: 'relief_saved_facilities',
      label: 'Saved facilities',
      category: 'health',
      personal: false,
      holds: 'Name, address, phone, coordinates and save date of hospitals you pressed Save on.',
      retention: 'Until you remove the facility or delete your data.'
    },
    {
      key: 'userLocation',
      label: 'Saved location',
      category: 'location',
      personal: true,
      holds: 'Latitude and longitude rounded to 2 decimals (about 1 km), the text you typed for a manual location, source (gps or manual), save and expiry time.',
      retention: 'A device location expires after 1 day and a typed location after 7 days. An expired value is removed the next time a page reads it.'
    },
    {
      key: 'selectedDoctor',
      label: 'Selected doctor',
      category: 'health',
      personal: false,
      holds: 'The doctor card (name, specialty, image) from the directory that you picked to book.',
      retention: 'Kept until overwritten by the next pick or until you delete your data.'
    },
    {
      key: 'relief_demo_health_events',
      label: 'Health event submissions (demo queue)',
      category: 'technical',
      personal: true,
      holds: 'Events you submitted in demo mode: title, date, venue, organiser, services, eligibility, contact phone or email, and any moderator decision.',
      retention: 'Until you delete your data. Only written in demo mode (localhost, file:// or an explicit demo flag) when the review service cannot be reached.'
    },
    {
      key: 'relief_health_event_submissions',
      label: 'Submission limiter (Health events)',
      category: 'technical',
      personal: false,
      holds: 'Times and a fingerprint (title, start time, district) of events you submitted, used to stop duplicates and repeated submissions.',
      retention: 'Entries older than 7 days are dropped; at most 50 kept. Included in deletion.'
    },
    {
      key: 'relief_lang',
      label: 'Language choice',
      category: 'preferences',
      personal: false,
      holds: 'The language code you picked (en or bn).',
      retention: 'Until you delete your data.'
    },
    {
      key: 'relief_last_online_sync',
      label: 'Last online visit time',
      category: 'technical',
      personal: false,
      holds: 'A timestamp, used to say when the offline copy was last refreshed.',
      retention: 'Overwritten on every online page load. It comes back on your next visit after deletion.'
    },
    {
      key: 'relief_formguard_contact',
      label: 'Submission limiter (Contact form)',
      category: 'technical',
      personal: false,
      holds: 'Timestamps of recent attempts only, used to slow down repeated submissions. No form content.',
      retention: 'Entries older than the limit window (1 to 10 minutes) are ignored and removed. Included in deletion.'
    },
    {
      key: 'relief_formguard_login',
      label: 'Submission limiter (Login)',
      category: 'technical',
      personal: false,
      holds: 'Timestamps of recent attempts only, used to slow down repeated submissions. No form content.',
      retention: 'Entries older than the limit window (1 to 10 minutes) are ignored and removed. Included in deletion.'
    },
    {
      key: 'relief_formguard_signup',
      label: 'Submission limiter (Signup)',
      category: 'technical',
      personal: false,
      holds: 'Timestamps of recent attempts only, used to slow down repeated submissions. No form content.',
      retention: 'Entries older than the limit window (1 to 10 minutes) are ignored and removed. Included in deletion.'
    }
  ];

  function inventoryKeys() {
    return INVENTORY.map(function (item) { return item.key; });
  }

  function findInventoryItem(key) {
    for (var i = 0; i < INVENTORY.length; i++) {
      if (INVENTORY[i].key === key) return INVENTORY[i];
    }
    return null;
  }

  // True for keys deletion should remove: listed ones, plus anything starting with relief_.
  function isReliefKey(key) {
    return typeof key === 'string' && (key.indexOf(KEY_PREFIX) === 0 || findInventoryItem(key) !== null);
  }

  function getDefaultStorage() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  // Lists every key in a Storage-like object. Returns null when it cannot be listed.
  function listStorageKeys(storage) {
    if (!storage) return null;
    try {
      if (typeof storage.length === 'number' && typeof storage.key === 'function') {
        var keys = [];
        for (var i = 0; i < storage.length; i++) {
          var k = storage.key(i);
          if (k !== null && k !== undefined) keys.push(k);
        }
        return keys;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function readItem(storage, key) {
    try {
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  /**
   * Keys that are present in storage and would be deleted, in a stable order:
   * inventory keys first, then any other relief_* keys.
   */
  function findStoredKeys(storage) {
    var store = storage === undefined ? getDefaultStorage() : storage;
    if (!store) return [];
    var present = [];
    var seen = {};
    inventoryKeys().forEach(function (key) {
      if (readItem(store, key) !== null) { present.push(key); seen[key] = true; }
    });
    (listStorageKeys(store) || []).forEach(function (key) {
      if (!seen[key] && key.indexOf(KEY_PREFIX) === 0 && readItem(store, key) !== null) {
        present.push(key);
        seen[key] = true;
      }
    });
    return present;
  }

  /** What is stored right now, as { key, label, personal } rows for display. */
  function describeStored(storage) {
    return findStoredKeys(storage).map(function (key) {
      var item = findInventoryItem(key);
      return { key: key, label: item ? item.label : 'Other RELIEF data (' + key + ')', personal: item ? item.personal : true };
    });
  }

  /**
   * Removes every RELIEF key from storage and checks that each one is gone.
   * state: 'deleted' | 'nothing' (nothing was stored) | 'partial' | 'unavailable'
   */
  function deleteLocalData(storage) {
    var store = storage === undefined ? getDefaultStorage() : storage;
    if (!store) {
      return { state: 'unavailable', found: [], removed: [], failed: [], remaining: [] };
    }

    var found = findStoredKeys(store);
    var removed = [];
    var failed = [];
    found.forEach(function (key) {
      try {
        store.removeItem(key);
      } catch (e) {
        // checked below
      }
      if (readItem(store, key) === null) removed.push(key); else failed.push(key);
    });

    var state = failed.length ? 'partial' : (found.length ? 'deleted' : 'nothing');
    return { state: state, found: found, removed: removed, failed: failed, remaining: findStoredKeys(store) };
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var err = new Error('timeout');
        err.code = 'relief/timeout';
        reject(err);
      }, ms);
      promise.then(function (value) { clearTimeout(timer); resolve(value); },
        function (error) { clearTimeout(timer); reject(error); });
    });
  }

  var SERVER_MESSAGES = {
    'not-needed': 'This was a demo account. It only existed in this browser, so there is no copy on a server.',
    'not-signed-in': 'You were not signed in, so no account on a server was contacted. If you created one earlier, sign in and try again.',
    unavailable: 'The sign-in service is not connected, so RELIEF could not delete an account on a server. If you created one, it still exists. Ask whoever runs this deployment to delete it.',
    deleted: 'The sign-in service confirmed that your account and its data were deleted.',
    recentLogin: 'The sign-in service needs a recent sign-in before it will delete an account. Nothing was deleted on the server. Sign in again and retry.',
    failed: 'The sign-in service did not delete your account, so it may still exist on the server and some of its data may already be gone. Try again later or contact whoever runs this deployment.'
  };

  /**
   * Asks the sign-in service to delete the account. Resolves
   * { state: 'not-needed' | 'not-signed-in' | 'unavailable' | 'deleted' | 'failed', message, code? }
   * and never rejects. 'deleted' only when the service resolved with success === true.
   */
  async function deleteServerAccount(api, user, options) {
    var timeout = options && options.timeoutMs ? options.timeoutMs : SERVER_TIMEOUT_MS;
    if (user && user.demo) return { state: 'not-needed', message: SERVER_MESSAGES['not-needed'] };
    if (!user) return { state: 'not-signed-in', message: SERVER_MESSAGES['not-signed-in'] };
    if (!api || typeof api.deleteAccount !== 'function') {
      return { state: 'unavailable', message: SERVER_MESSAGES.unavailable };
    }
    try {
      var result = await withTimeout(Promise.resolve(api.deleteAccount()), timeout);
      if (result && result.success === true) return { state: 'deleted', message: SERVER_MESSAGES.deleted };
      return { state: 'failed', message: SERVER_MESSAGES.failed };
    } catch (error) {
      var code = error && typeof error.code === 'string' ? error.code : '';
      if (code === 'auth/requires-recent-login') {
        return { state: 'failed', code: code, message: SERVER_MESSAGES.recentLogin };
      }
      // Only the error code is kept. The message can contain account details.
      return { state: 'failed', code: code || undefined, message: SERVER_MESSAGES.failed };
    }
  }

  async function signOutQuietly(api) {
    if (!api || typeof api.logout !== 'function') return;
    try {
      await api.logout();
    } catch (e) {
      // the local session is removed anyway
    }
  }

  /**
   * Full deletion. deps: { storage, api, user, timeoutMs }.
   * status: 'complete' | 'local-only' | 'partial' | 'failed'
   *   complete   local data removed and the server part is deleted or not needed (demo account)
   *   local-only local data removed but the server account was not deleted or not contacted
   *   partial    some local keys could not be removed
   *   failed     browser storage was not available
   */
  async function deleteAccount(deps) {
    var d = deps || {};
    var server = await deleteServerAccount(d.api, d.user, { timeoutMs: d.timeoutMs });
    // Sign out of the service before the local keys go, then remove the keys.
    if (server.state === 'deleted') await signOutQuietly(d.api);
    var local = deleteLocalData(d.storage);

    var status;
    if (local.state === 'unavailable') status = 'failed';
    else if (local.state === 'partial') status = 'partial';
    else if (server.state === 'deleted' || server.state === 'not-needed') status = 'complete';
    else status = 'local-only';

    return { status: status, local: local, server: server };
  }

  function labelFor(key) {
    var item = findInventoryItem(key);
    return item ? item.label : key;
  }

  /**
   * Turns a deletion result into text for the page: { tone, headline, lines }.
   * tone: 'success' | 'warning' | 'error'
   */
  function describeResult(result) {
    var local = result.local;
    var server = result.server;
    var lines = [];
    var headline;
    var tone;

    if (result.status === 'failed') {
      headline = 'Nothing was deleted.';
      tone = 'error';
      lines.push('Browser storage is not available or is blocked, so RELIEF could not remove its data from this browser.');
    } else {
      if (result.status === 'partial') {
        headline = 'Some data could not be deleted.';
        tone = 'error';
        lines.push('Could not remove: ' + local.failed.map(labelFor).join(', ') + '. Clear this site\'s data in your browser settings to remove it.');
      } else if (result.status === 'complete') {
        headline = server.state === 'deleted' ? 'Your account and local data were deleted.' : 'Your demo account and local data were deleted.';
        tone = 'success';
      } else {
        headline = 'Local data was deleted. No account on a server was deleted.';
        tone = 'warning';
      }
      if (local.removed.length) {
        lines.push('Removed from this browser: ' + local.removed.map(labelFor).join(', ') + '.');
      } else if (!local.found.length) {
        lines.push('There was no RELIEF data stored in this browser.');
      }
    }

    if (result.status !== 'failed') lines.push(server.message);
    lines.push('Copies you shared with others (an SMS, a phone call, a map search on another site) are not stored by RELIEF and cannot be deleted by it.');
    if (result.status !== 'failed') {
      lines.push('Your language choice and a last-visit timestamp are written again the next time you use the site.');
    }
    return { tone: tone, headline: headline, lines: lines };
  }

  return {
    KEY_PREFIX: KEY_PREFIX,
    INVENTORY: INVENTORY,
    inventoryKeys: inventoryKeys,
    isReliefKey: isReliefKey,
    listStorageKeys: listStorageKeys,
    findStoredKeys: findStoredKeys,
    describeStored: describeStored,
    deleteLocalData: deleteLocalData,
    deleteServerAccount: deleteServerAccount,
    deleteAccount: deleteAccount,
    describeResult: describeResult
  };
}));
