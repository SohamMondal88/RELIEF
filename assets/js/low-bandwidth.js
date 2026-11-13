/**
 * Low-data mode (Issue #50). See docs/LOW_BANDWIDTH.md.
 *
 * The mode is a switch the person controls, kept as "on" or "off" in localStorage (relief_low_bandwidth).
 * It never turns itself on: when the browser reports Data Saver or a slow connection the page only
 * offers it. While it is on, <html> has the class "relief-lite" and assets/css/low-bandwidth.css stops
 * animations, skips the landing splash and hides decorative pictures. SOS, facility search, first aid
 * and every phone link are untouched, and nothing here waits for a picture or an animation.
 *
 * The prefers-reduced-motion setting is separate and always respected: switching this mode off never
 * brings back motion the visitor has asked the system to remove, because that is handled by the
 * existing @media (prefers-reduced-motion: reduce) rules, not by this script.
 *
 * Load it from <head> so the class is set before the page is drawn.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReliefLowBandwidth = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY = 'relief_low_bandwidth';
  var CLASS = 'relief-lite';
  var SLOW_TYPES = ['slow-2g', '2g', '3g'];

  /** 'on', 'off' or null (never chosen, or unreadable). Anything but the two exact words counts as never chosen. */
  function readPreference(storage) {
    try {
      var value = storage.getItem(KEY);
      return value === 'on' || value === 'off' ? value : null;
    } catch (e) {
      return null;
    }
  }

  /** Saves 'on' or 'off'. Returns false when storage is blocked or full, so the page can say so. */
  function writePreference(storage, value) {
    if (value !== 'on' && value !== 'off') return false;
    try {
      storage.setItem(KEY, value);
      return storage.getItem(KEY) === value;
    } catch (e) {
      return false;
    }
  }

  /**
   * What the browser says about the connection (Network Information API, not available everywhere).
   * Returns { saveData, slow, suggest }. A missing or odd value means no hint, never a guess.
   */
  function connectionHint(nav) {
    var c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    var saveData = !!(c && c.saveData === true);
    var slow = !!(c && typeof c.effectiveType === 'string' && SLOW_TYPES.indexOf(c.effectiveType) !== -1);
    return { saveData: saveData, slow: slow, suggest: saveData || slow };
  }

  /** The mode is on only when the person turned it on. A hint alone never switches it on. */
  function isActive(preference) {
    return preference === 'on';
  }

  /** What the bar should offer: 'suggest' (hint and no choice yet), 'on' or 'off'. */
  function barState(preference, hint) {
    if (preference === 'on') return 'on';
    if (preference === null && hint && hint.suggest) return 'suggest';
    return 'off';
  }

  function apply(doc, active) {
    var html = doc.documentElement;
    if (active) html.classList.add(CLASS); else html.classList.remove(CLASS);
  }

  // True for a picture the mode may defer: not the brand logo and not part of a map.
  function deferable(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'IMG') return false;
    if (typeof node.className === 'string' && node.className.indexOf('leaflet') !== -1) return false;
    return !(node.closest && node.closest('.logo, .brand, .leaflet-container'));
  }

  /**
   * Marks pictures as lazy while the page is being read. A lazy picture that is hidden or far below the
   * screen is never requested, which is what keeps the decorative ones off the network. Stops when the
   * page has been read, so pictures that script adds later (map tiles) load as usual. It uses the
   * browser's own loading="lazy" and so depends on browser support: where the browser has already
   * started a picture by then, it is only hidden, not saved.
   */
  function deferPictures(win) {
    if (!win.MutationObserver) return;
    var observer = new win.MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (deferable(node)) node.loading = 'lazy';
        });
      });
    });
    observer.observe(win.document, { childList: true, subtree: true });
    win.document.addEventListener('DOMContentLoaded', function () { observer.disconnect(); });
  }

  var api = {
    KEY: KEY,
    CLASS: CLASS,
    readPreference: readPreference,
    writePreference: writePreference,
    connectionHint: connectionHint,
    isActive: isActive,
    barState: barState,
    apply: apply,
    deferable: deferable
  };

  // ---- in the browser -------------------------------------------------------------------------

  if (typeof document === 'undefined' || !root || !root.document) return api;

  var storage;
  try { storage = root.localStorage; } catch (e) { storage = null; }
  var pref = storage ? readPreference(storage) : null;
  apply(document, isActive(pref));
  if (isActive(pref)) deferPictures(root);

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildBar() {
    var bar = document.getElementById('relief-lite-bar');
    if (bar) bar.parentNode.removeChild(bar);
    bar = el('div', 'relief-lite-bar');
    bar.id = 'relief-lite-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Low-data mode');

    var state = barState(pref, connectionHint(root.navigator));
    var message = el('p', 'relief-lite-text');
    var main = el('button', 'relief-lite-btn');
    main.type = 'button';
    var status = el('p', 'relief-lite-note');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    function choose(value) {
      var saved = storage ? writePreference(storage, value) : false;
      pref = value;
      apply(document, isActive(value));
      buildBar();
      if (!saved) {
        var note = document.querySelector('#relief-lite-bar .relief-lite-note');
        if (note) note.textContent = 'Your browser would not save this choice, so it applies to this page only.';
      }
      var btn = document.querySelector('#relief-lite-bar .relief-lite-btn');
      if (btn) btn.focus();
    }

    if (state === 'suggest') {
      message.textContent = 'Your connection looks slow or Data Saver is on. Turn on low-data mode to load less?';
      main.textContent = 'Turn on';
      main.addEventListener('click', function () { choose('on'); });
      var later = el('button', 'relief-lite-btn relief-lite-btn--quiet', 'Not now');
      later.type = 'button';
      later.addEventListener('click', function () { choose('off'); });
      bar.appendChild(message);
      bar.appendChild(main);
      bar.appendChild(later);
    } else if (state === 'on') {
      message.textContent = 'Low-data mode is on. Animations and decorative pictures are off. SOS, search and phone links work as usual.';
      main.textContent = 'Turn off';
      main.setAttribute('aria-pressed', 'true');
      main.addEventListener('click', function () { choose('off'); });
      bar.appendChild(message);
      bar.appendChild(main);
    } else {
      message.textContent = 'Low-data mode is off.';
      main.textContent = 'Turn on low-data mode';
      main.setAttribute('aria-pressed', 'false');
      main.addEventListener('click', function () { choose('on'); });
      bar.appendChild(message);
      bar.appendChild(main);
    }
    bar.appendChild(status);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function start() { buildBar(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  return api;
});
