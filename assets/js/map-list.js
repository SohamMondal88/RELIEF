/**
 * Accessible list alternative for the Leaflet maps on the hospitals, pharmacies and ambulances pages
 * (Issue #80).
 *
 * Every result on a map is also a card in the list above the map, with its name, address and action
 * buttons. The map is an extra, so this file only makes sure that:
 *   - the list is announced as a list (one item per result) and says how many results it has,
 *   - the map has a name, says that the list has the same results, and can be skipped with the keyboard
 *     (every marker is a tab stop),
 *   - each marker has the facility's name as its accessible name,
 *   - the person is told, in text, when the map pictures or the map library did not load, and that
 *     the list still has everything.
 *
 * Plain functions with the document passed in. The wiring is in hospitals.js, pharmacies.js and
 * ambulances.js, and the behaviour is covered by tests/map-list.test.js and e2e/map-list.spec.js.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefMapList = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOTE_MAP_OK = 'The map is an extra. Every result is also in the list above, with its address and actions, and the list works without the map.';
  var NOTE_TILES_FAILED = 'The map pictures could not be loaded. The list above still has every result, with its address and actions.';
  var NOTE_NO_MAP = 'The map could not be loaded. The list above still has every result, with its address and actions.';

  function text(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  /** "Name, place" for a marker. Falls back to the name alone, and to a plain word if there is no name. */
  function markerLabel(name, place) {
    var n = text(name);
    var p = text(place);
    if (!n) return 'Map marker';
    return p ? n + ', ' + p : n;
  }

  /** Options for L.marker so the marker has a name for screen readers and a tooltip. */
  function markerOptions(name, place) {
    var label = markerLabel(name, place);
    return { title: label, alt: label, keyboard: true };
  }

  /**
   * Leaflet 1.7 makes a marker focusable (tabindex 0) but leaves it as a bare image. Calling this after
   * the marker is on the map tells screen readers it is a button (Enter opens its popup).
   */
  function decorateMarker(marker) {
    try {
      var node = marker && typeof marker.getElement === 'function' ? marker.getElement() : null;
      if (node && !node.getAttribute('role')) node.setAttribute('role', 'button');
    } catch (e) { /* a marker without an element is left as it is */ }
    return marker;
  }

  /** "3 results listed above" style text for the map region. */
  function describeMap(noun) {
    var n = text(noun) || 'results';
    return 'Map of ' + n + '. The same results are listed above with their addresses and actions.';
  }

  /**
   * Marks a results container as a list of its cards. Only when there is at least one card: an empty
   * result, a loading line or an error message inside a role="list" would be an invalid list.
   * Returns the number of items.
   */
  function markList(listEl, itemSelector, label) {
    if (!listEl) return 0;
    var items = Array.prototype.slice.call(listEl.querySelectorAll(itemSelector)).filter(function (el) {
      return el.parentNode === listEl;
    });
    if (items.length === 0) {
      listEl.removeAttribute('role');
      listEl.removeAttribute('aria-label');
      return 0;
    }
    listEl.setAttribute('role', 'list');
    listEl.setAttribute('aria-label', text(label) || 'Results');
    items.forEach(function (el) { el.setAttribute('role', 'listitem'); });
    return items.length;
  }

  /**
   * Gives the map element a name, adds the note about the list and a "Skip the map" link in front of
   * it and a landing spot after it. Safe to call once per page. Returns { note, skip, end } or null.
   */
  function prepare(doc, mapEl, options) {
    if (!doc || !mapEl || !mapEl.parentNode) return null;
    var opts = options || {};
    var parent = mapEl.parentNode;
    var id = mapEl.id || 'map';

    mapEl.setAttribute('role', 'region');
    mapEl.setAttribute('aria-label', describeMap(opts.noun));

    var note = doc.createElement('p');
    note.className = 'map-note';
    note.id = id + '-note';
    note.setAttribute('role', 'status');
    note.textContent = NOTE_MAP_OK;

    var skip = doc.createElement('a');
    skip.className = 'map-skip-link';
    skip.href = '#' + id + '-end';
    skip.textContent = 'Skip the map';

    var end = doc.createElement('div');
    end.id = id + '-end';
    end.setAttribute('tabindex', '-1');

    parent.insertBefore(note, mapEl);
    parent.insertBefore(skip, mapEl);
    if (mapEl.nextSibling) parent.insertBefore(end, mapEl.nextSibling);
    else parent.appendChild(end);

    // The link target is a plain div, so move focus there on activation (some browsers only scroll).
    skip.addEventListener('click', function (event) {
      event.preventDefault();
      end.focus();
    });
    return { note: note, skip: skip, end: end };
  }

  /** The map pictures (tiles) failed to load. The map and its markers may still work, so only the note changes. */
  function tilesFailed(refs) {
    if (refs && refs.note) refs.note.textContent = NOTE_TILES_FAILED;
  }

  /** Leaflet did not load at all. Hide the empty map and its skip link and say so. */
  function mapMissing(refs, mapEl) {
    if (refs && refs.note) refs.note.textContent = NOTE_NO_MAP;
    if (refs && refs.skip) refs.skip.hidden = true;
    if (mapEl) mapEl.hidden = true;
  }

  /** Calls onFail once, the first time the tile layer reports a tile that could not be loaded. */
  function watchTiles(tileLayer, onFail) {
    if (!tileLayer || typeof tileLayer.on !== 'function') return;
    var failed = false;
    tileLayer.on('tileerror', function () {
      if (failed) return;
      failed = true;
      onFail();
    });
  }

  return {
    NOTE_MAP_OK: NOTE_MAP_OK,
    NOTE_TILES_FAILED: NOTE_TILES_FAILED,
    NOTE_NO_MAP: NOTE_NO_MAP,
    markerLabel: markerLabel,
    markerOptions: markerOptions,
    decorateMarker: decorateMarker,
    describeMap: describeMap,
    markList: markList,
    prepare: prepare,
    tilesFailed: tilesFailed,
    mapMissing: mapMissing,
    watchTiles: watchTiles
  };
}));
