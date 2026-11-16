/*
 * RELIEF safe browser storage helpers (Issue #168).
 *
 * localStorage can fail in more ways than "empty": the browser can block it (reading
 * window.localStorage then throws a SecurityError), a write can hit the quota, and a value
 * can be half written, edited by hand or left by an older build. Nothing here throws.
 *
 *   getStorage(win)                    the Storage, or null when the browser will not give it
 *   parseJson(raw, isValid)            { ok, value }; ok is false for bad JSON or a wrong shape
 *   readJson(storage, key, isValid)    { status, value, raw }
 *                                      status: 'unavailable' | 'missing' | 'ok' | 'unreadable'
 *   setItem(storage, key, text)        true when saved, false on quota, blocked or no storage
 *   removeItem(storage, key)           true when removed (or nothing was there)
 *   keepUnreadable(storage, key, raw)  copies an unreadable value to key + '.unreadable' once
 *   preserveUnreadable(storage, key, isValid)
 *                                      readJson, and keeps the raw value when it is unreadable
 *
 * "Unreadable" values are kept, not thrown away: the page shows its empty state, but the damaged
 * text is copied aside before anything is written over it, so it can still be recovered by hand.
 * The copy lives in the same browser and is removed with the rest of RELIEF's data (every key
 * starting with relief_ is cleared by "Delete my data", see docs/PRIVACY_AND_DATA.md).
 *
 * Works in the browser (window.ReliefSafeStorage) and in node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReliefSafeStorage = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BACKUP_SUFFIX = '.unreadable';

  // Reading window.localStorage is what throws when the browser blocks storage, so it is the
  // part that has to sit inside the try.
  function getStorage(win) {
    try {
      var w = win === undefined ? (typeof window !== 'undefined' ? window : null) : win;
      return (w && w.localStorage) || null;
    } catch (e) {
      return null;
    }
  }

  function parseJson(raw, isValid) {
    if (typeof raw !== 'string') return { ok: false, value: undefined };
    var value;
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { ok: false, value: undefined };
    }
    if (typeof isValid === 'function') {
      var valid;
      try { valid = isValid(value); } catch (e) { valid = false; }
      if (!valid) return { ok: false, value: undefined };
    }
    return { ok: true, value: value };
  }

  function readJson(storage, key, isValid) {
    var raw;
    try {
      if (!storage) return { status: 'unavailable', value: undefined, raw: null };
      raw = storage.getItem(key);
    } catch (e) {
      return { status: 'unavailable', value: undefined, raw: null };
    }
    if (raw === null || raw === undefined || raw === '') return { status: 'missing', value: undefined, raw: null };
    var parsed = parseJson(raw, isValid);
    if (!parsed.ok) return { status: 'unreadable', value: undefined, raw: raw };
    return { status: 'ok', value: parsed.value, raw: raw };
  }

  function setItem(storage, key, text) {
    try {
      if (!storage) return false;
      storage.setItem(key, text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function removeItem(storage, key) {
    try {
      if (!storage) return false;
      storage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Keeps the first damaged value. A second damaged value does not replace it, so a good
  // recovery copy is never lost to a later accident. Returns true when a copy exists afterwards.
  function keepUnreadable(storage, key, raw) {
    if (typeof raw !== 'string') return false;
    try {
      if (!storage) return false;
      if (storage.getItem(key + BACKUP_SUFFIX) !== null) return true;
    } catch (e) {
      return false;
    }
    return setItem(storage, key + BACKUP_SUFFIX, raw);
  }

  function preserveUnreadable(storage, key, isValid) {
    var result = readJson(storage, key, isValid);
    if (result.status === 'unreadable') {
      result.kept = keepUnreadable(storage, key, result.raw);
    }
    return result;
  }

  return {
    BACKUP_SUFFIX: BACKUP_SUFFIX,
    getStorage: getStorage,
    parseJson: parseJson,
    readJson: readJson,
    setItem: setItem,
    removeItem: removeItem,
    keepUnreadable: keepUnreadable,
    preserveUnreadable: preserveUnreadable
  };
});
