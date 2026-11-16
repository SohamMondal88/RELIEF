/**
 * Saved facilities (Issue #54).
 *
 * The list lives in this browser only (localStorage, key relief_saved_facilities). Nothing is sent
 * anywhere and there is no account sync, and the page says so. This file has no DOM code so it can be
 * tested with node:test.
 *
 *   read(storage)            valid, de-duplicated items; reports what was dropped or unreadable
 *   toggle(storage, f)       save or remove one facility; says whether the write really worked
 *   remove(storage, id)      remove by id
 *   snapshot(f)              what is stored for a facility: its own public details and the save date, nothing else
 *   reconcile(items, list)   marks each saved item as listed, no longer listed, or not checked
 *   syncNotes(opts)          the plain statements about where the list lives (signed in / out, online / offline)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReliefSaved = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'relief_saved_facilities';

  function isText(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function coord(lat, lng) {
    var ok = typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
    return ok ? { lat: lat, lng: lng } : { lat: null, lng: null };
  }

  /**
   * The stored copy of a facility. It is the facility's own public details (name, area, phone and the
   * facility's position for directions) plus when it was saved. Anything else on the object, such as a
   * distance worked out from the visitor's location, is left out on purpose, so the visitor's position
   * is never written into the saved list.
   */
  function snapshot(facility, now) {
    var f = facility || {};
    var c = coord(f.lat, f.lng);
    return {
      id: f.id,
      name: String(f.name),
      location: isText(f.address) ? f.address : (isText(f.district) ? f.district : ''),
      phone: isText(f.phone) ? f.phone : null,
      lat: c.lat,
      lng: c.lng,
      savedAt: typeof now === 'number' ? now : Date.now()
    };
  }

  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' && typeof raw.id !== 'number') return null;
    if (!isText(String(raw.id)) || !isText(raw.name)) return null;
    var c = coord(raw.lat, raw.lng);
    return {
      id: raw.id,
      name: raw.name,
      location: isText(raw.location) ? raw.location : '',
      phone: isText(raw.phone) ? raw.phone : null,
      lat: c.lat,
      lng: c.lng,
      savedAt: typeof raw.savedAt === 'number' && isFinite(raw.savedAt) ? raw.savedAt : null
    };
  }

  /**
   * Reads the saved list. Returns { items, dropped, unreadable, unavailable }:
   *  - items: valid entries, the same facility only once (the first one is kept)
   *  - dropped: how many entries were broken or repeated
   *  - unreadable: the stored text was not a list (it is left in place until the next save)
   *  - unavailable: the browser would not let the page read its storage at all
   */
  function read(storage) {
    var text;
    try {
      text = storage.getItem(KEY);
    } catch (e) {
      return { items: [], dropped: 0, unreadable: false, unavailable: true };
    }
    if (text === null || text === undefined || text === '') return { items: [], dropped: 0, unreadable: false, unavailable: false };
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { items: [], dropped: 0, unreadable: true, unavailable: false };
    }
    if (!Array.isArray(parsed)) return { items: [], dropped: 0, unreadable: true, unavailable: false };
    // no prototype, so ids like "constructor" or "toString" are not mistaken for repeats
    var seen = Object.create(null);
    var items = [];
    var dropped = 0;
    parsed.forEach(function (raw) {
      var item = cleanItem(raw);
      if (!item || seen[String(item.id)]) {
        dropped += 1;
        return;
      }
      seen[String(item.id)] = true;
      items.push(item);
    });
    return { items: items, dropped: dropped, unreadable: false, unavailable: false };
  }

  /** Writes the list. { ok: true } or { ok: false, reason: 'storage' } (blocked, full, private mode). */
  function write(storage, items) {
    try {
      storage.setItem(KEY, JSON.stringify(items));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'storage' };
    }
  }

  /**
   * Saves the facility, or removes it if it is already saved (so a second press never makes a duplicate).
   * Returns { ok, saved, items, reason }. When the write fails nothing has changed: `saved` is the state
   * before the press and `items` the list as it still is.
   */
  function toggle(storage, facility, now) {
    if (!facility || (typeof facility.id !== 'string' && typeof facility.id !== 'number') || !isText(facility.name)) {
      return { ok: false, saved: false, items: [], reason: 'invalid' };
    }
    var current = read(storage);
    if (current.unavailable) return { ok: false, saved: false, items: [], reason: 'storage' };
    var id = String(facility.id);
    var exists = current.items.some(function (item) { return String(item.id) === id; });
    var next = exists
      ? current.items.filter(function (item) { return String(item.id) !== id; })
      : current.items.concat([snapshot(facility, now)]);
    var result = write(storage, next);
    if (!result.ok) return { ok: false, saved: exists, items: current.items, reason: result.reason };
    return { ok: true, saved: !exists, items: next, reason: null };
  }

  function remove(storage, id) {
    var current = read(storage);
    if (current.unavailable) return { ok: false, items: [], reason: 'storage' };
    var next = current.items.filter(function (item) { return String(item.id) !== String(id); });
    var result = write(storage, next);
    if (!result.ok) return { ok: false, items: current.items, reason: result.reason };
    return { ok: true, items: next, reason: null };
  }

  /**
   * Compares saved items with the current directory.
   * listed: the directory has it. missing: the directory loaded and does not have it any more.
   * unchecked: the directory is not available (offline, failed to load), so nothing can be said.
   * Each result is { item, status, current } where current is the directory record for listed items.
   */
  function reconcile(items, directory) {
    var byId = null;
    if (Array.isArray(directory)) {
      byId = Object.create(null);
      directory.forEach(function (f) { if (f && f.id != null) byId[String(f.id)] = f; });
    }
    return items.map(function (item) {
      if (!byId) return { item: item, status: 'unchecked', current: null };
      var match = byId[String(item.id)];
      return match ? { item: item, status: 'listed', current: match } : { item: item, status: 'missing', current: null };
    });
  }

  /**
   * Plain statements about where the list lives. opts: { signedIn, online, unavailable }.
   * Cross-device sync is not supported, so being signed in changes nothing about where the list is kept.
   */
  function syncNotes(opts) {
    var o = opts || {};
    var notes = [];
    if (o.unavailable) {
      notes.push('Saving is not available in this browser right now (storage is blocked), so nothing you save will be kept.');
    }
    notes.push(o.signedIn
      ? 'You are signed in, but saved facilities are not synced to your account. They stay on this device only.'
      : 'You are not signed in. Saved facilities stay on this device only, and you do not need an account to use them.');
    notes.push('They are not copied to your other devices, and clearing this browser’s data removes them.');
    if (o.online === false) {
      notes.push('You are offline. The saved copies below still work, but they may be out of date, so call before you travel.');
    }
    return notes;
  }

  return {
    KEY: KEY,
    snapshot: snapshot,
    read: read,
    write: write,
    toggle: toggle,
    remove: remove,
    reconcile: reconcile,
    syncNotes: syncNotes
  };
});
