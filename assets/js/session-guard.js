/**
 * Relief Healthcare Platform - Session expiry and cross-tab sign-out
 *
 * Keeps the signed-in state predictable:
 *  - one place defines when a session ends (idle timeout and absolute lifetime)
 *  - signing out or expiring in one tab ends the session in every open tab
 *  - when a session ends, protected content is removed from the page and the user
 *    gets a clear prompt to sign in again
 *  - a failed refresh with the sign-in service ends the session instead of leaving
 *    a tab that looks signed in but is not
 *
 * The session kept in the browser is UI state only. It decides what the page shows, it
 * is NOT what protects data. Access to stored data must be authorised on the server
 * (Firestore Security Rules, see docs/FIREBASE_SECURITY.md).
 *
 * Nothing in this file writes tokens, emails or user data to the console.
 *
 * Implements Issue #57: Add secure session expiry and cross-tab logout handling.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ReliefSessionGuard = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    storageKey: 'relief_auth_sessions',
    channelName: 'relief-auth',
    idleTimeoutMs: 30 * 60 * 1000, // no activity for 30 minutes ends the session
    absoluteTimeoutMs: 7 * 24 * 60 * 60 * 1000, // sessions never live longer than 7 days
    checkIntervalMs: 30 * 1000, // how often a tab re-checks its session
    refreshIntervalMs: 10 * 60 * 1000, // how often the sign-in service is asked to refresh
    touchThrottleMs: 30 * 1000, // activity is written to storage at most this often
    clockSkewMs: 5 * 60 * 1000 // tolerated difference when a stored time is "in the future"
  };

  const REASONS = {
    IDLE: 'idle',
    EXPIRED: 'expired',
    SIGNED_OUT: 'signed-out',
    REFRESH_FAILED: 'refresh-failed'
  };

  const MESSAGES = {
    idle: 'You were signed out because you were inactive for a while.',
    expired: 'Your session has expired.',
    'signed-out': 'You were signed out in another tab.',
    'refresh-failed': 'We could not confirm your sign-in.'
  };

  function positive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** Defaults, then window.ReliefSessionConfig, then explicit options. Bad values fall back. */
  function resolveConfig(options, globalConfig) {
    const merged = Object.assign({}, DEFAULTS, globalConfig || {}, options || {});
    return {
      storageKey: String(merged.storageKey || DEFAULTS.storageKey),
      channelName: String(merged.channelName || DEFAULTS.channelName),
      idleTimeoutMs: positive(merged.idleTimeoutMs, DEFAULTS.idleTimeoutMs),
      absoluteTimeoutMs: positive(merged.absoluteTimeoutMs, DEFAULTS.absoluteTimeoutMs),
      checkIntervalMs: positive(merged.checkIntervalMs, DEFAULTS.checkIntervalMs),
      refreshIntervalMs: positive(merged.refreshIntervalMs, DEFAULTS.refreshIntervalMs),
      touchThrottleMs: positive(merged.touchThrottleMs, DEFAULTS.touchThrottleMs),
      clockSkewMs: positive(merged.clockSkewMs, DEFAULTS.clockSkewMs)
    };
  }

  function globalConfig() {
    return typeof globalThis !== 'undefined' ? globalThis.ReliefSessionConfig : undefined;
  }

  /**
   * Decide whether one stored session is still usable.
   * @returns {{valid: boolean, reason?: string}}
   */
  function evaluateSession(session, now, config) {
    const cfg = config || resolveConfig(undefined, globalConfig());
    if (!session || typeof session !== 'object' || !session.user) {
      return { valid: false, reason: REASONS.EXPIRED };
    }

    const created = Number(session.createdAt);
    const lastActive = Number(session.lastActiveAt);
    if (!Number.isFinite(created) || !Number.isFinite(lastActive)) {
      return { valid: false, reason: REASONS.EXPIRED };
    }

    // A time far in the future means the clock was changed or the data was edited.
    if (created > now + cfg.clockSkewMs || lastActive > now + cfg.clockSkewMs) {
      return { valid: false, reason: REASONS.EXPIRED };
    }

    if (now - created >= cfg.absoluteTimeoutMs) return { valid: false, reason: REASONS.EXPIRED };
    if (Number.isFinite(Number(session.expiresAt)) && Number(session.expiresAt) <= now) {
      return { valid: false, reason: REASONS.EXPIRED };
    }
    if (now - lastActive >= cfg.idleTimeoutMs) return { valid: false, reason: REASONS.IDLE };

    return { valid: true };
  }

  function messageFor(reason) {
    return MESSAGES[reason] || MESSAGES.expired;
  }

  /** localStorage wrapper that never throws. */
  function safeStore(backing) {
    return {
      read(key) {
        try {
          return backing ? backing.getItem(key) : null;
        } catch (e) {
          return null;
        }
      },
      write(key, value) {
        try {
          if (backing) backing.setItem(key, value);
          return true;
        } catch (e) {
          return false;
        }
      },
      remove(key) {
        try {
          if (backing) backing.removeItem(key);
        } catch (e) { /* ignore */ }
      }
    };
  }

  function parseSessions(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Watches the stored session for one page.
   *
   * @param {Object} options
   * @param {Storage}  [options.storage]       defaults to localStorage
   * @param {Function} [options.now]           defaults to Date.now
   * @param {Function} [options.onEnded]       called once with (reason, {remote})
   * @param {Function} [options.refresh]       async; a rejection ends the session
   * @param {Object}   [options.config]        overrides for the timeouts
   * @param {Object}   [options.target]        window-like (addEventListener for storage/focus/activity)
   * @param {Object}   [options.doc]           document-like (visibilityState, addEventListener)
   * @param {Function} [options.createChannel] returns a BroadcastChannel-like object, or null
   * @param {Object}   [options.timers]        { setInterval, clearInterval }
   */
  function createSessionWatcher(options) {
    const opts = options || {};
    const config = resolveConfig(opts.config, globalConfig());
    const now = opts.now || Date.now;
    const store = safeStore(opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null));
    const timers = opts.timers || { setInterval: setInterval, clearInterval: clearInterval };
    const target = opts.target || null;
    const doc = opts.doc || null;

    let tracking = false;
    let ended = false;
    let started = false;
    let checkTimer = null;
    let channel = null;
    let lastTouch = 0;
    let lastRefresh = 0;
    let refreshing = false;
    const cleanups = [];

    function load() {
      return parseSessions(store.read(config.storageKey));
    }

    function save(sessions) {
      if (sessions.length === 0) store.remove(config.storageKey);
      else store.write(config.storageKey, JSON.stringify(sessions));
    }

    /** Splits stored sessions into usable ones and the reason the newest dead one died. */
    function inspect() {
      const t = now();
      const sessions = load();
      const valid = [];
      let reason = null;
      let newest = -1;
      sessions.forEach((session) => {
        const result = evaluateSession(session, t, config);
        if (result.valid) {
          valid.push(session);
        } else {
          const stamp = Number(session && session.lastActiveAt) || 0;
          if (stamp >= newest) {
            newest = stamp;
            reason = result.reason;
          }
        }
      });
      return { sessions, valid, reason };
    }

    function broadcast(reason) {
      if (!channel) return;
      try {
        channel.postMessage({ type: 'logout', reason: reason });
      } catch (e) { /* channel closed */ }
    }

    function finish(reason, remote) {
      if (ended) return;
      ended = true;
      tracking = false;
      store.remove(config.storageKey);
      if (!remote) broadcast(reason);
      if (typeof opts.onEnded === 'function') {
        try {
          opts.onEnded(reason, { remote: Boolean(remote) });
        } catch (e) { /* a broken handler must not keep the session alive */ }
      }
    }

    /** Re-reads storage. Ends the session if this tab had one and none is left. */
    function checkNow() {
      if (ended) return;
      const state = inspect();

      // Tidy: drop dead sessions so they cannot be used later.
      if (state.valid.length !== state.sessions.length) save(state.valid);

      if (tracking && state.valid.length === 0) {
        // Storage was emptied by another tab (sign-out) unless we saw an expired entry.
        finish(state.reason || REASONS.SIGNED_OUT, false);
      }
    }

    function noteActivity() {
      if (!tracking || ended) return;
      const t = now();
      if (t - lastTouch < config.touchThrottleMs) return;
      lastTouch = t;

      const state = inspect();
      if (state.valid.length === 0) {
        checkNow();
        return;
      }
      // Only the most recently used valid session is extended.
      let latest = state.valid[0];
      state.valid.forEach((s) => { if (Number(s.lastActiveAt) > Number(latest.lastActiveAt)) latest = s; });
      latest.lastActiveAt = t;
      save(state.valid);
    }

    async function maybeRefresh(force) {
      if (!tracking || ended || refreshing || typeof opts.refresh !== 'function') return;
      const t = now();
      if (!force && t - lastRefresh < config.refreshIntervalMs) return;
      refreshing = true;
      lastRefresh = t;
      try {
        await opts.refresh();
      } catch (e) {
        // Do not log the error: it can contain account details.
        finish(REASONS.REFRESH_FAILED, false);
      } finally {
        refreshing = false;
      }
    }

    function tick() {
      checkNow();
      maybeRefresh(false);
    }

    function listen(emitter, name, handler, flags) {
      if (!emitter || typeof emitter.addEventListener !== 'function') return;
      emitter.addEventListener(name, handler, flags);
      cleanups.push(() => {
        if (typeof emitter.removeEventListener === 'function') emitter.removeEventListener(name, handler, flags);
      });
    }

    function onStorage(event) {
      // event.key is null when storage.clear() ran in another tab.
      if (!event || event.key === null || event.key === undefined || event.key === config.storageKey) checkNow();
    }

    function onVisible() {
      if (!doc || doc.visibilityState === 'visible') tick();
    }

    return {
      config: config,

      /** Begin watching. Returns true when a valid session exists in this tab. */
      start() {
        if (started) return tracking;
        started = true;

        const state = inspect();
        if (state.valid.length !== state.sessions.length) save(state.valid);
        tracking = state.valid.length > 0;
        lastRefresh = now();

        if (typeof opts.createChannel === 'function') {
          try { channel = opts.createChannel(config.channelName); } catch (e) { channel = null; }
        } else if (typeof BroadcastChannel !== 'undefined') {
          try { channel = new BroadcastChannel(config.channelName); } catch (e) { channel = null; }
        }
        if (channel) {
          channel.onmessage = (event) => {
            const data = event && event.data;
            // A tab that never had a session has nothing to end.
            if (data && data.type === 'logout' && tracking) finish(data.reason || REASONS.SIGNED_OUT, true);
          };
        }

        listen(target, 'storage', onStorage);
        listen(target, 'focus', onVisible);
        listen(doc, 'visibilitychange', onVisible);
        ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((name) => {
          listen(target, name, noteActivity, { passive: true });
        });

        checkTimer = timers.setInterval(tick, config.checkIntervalMs);
        return tracking;
      },

      /** Stop timers and listeners (page teardown, tests). */
      stop() {
        if (checkTimer !== null) timers.clearInterval(checkTimer);
        checkTimer = null;
        cleanups.splice(0).forEach((fn) => fn());
        if (channel && typeof channel.close === 'function') {
          try { channel.close(); } catch (e) { /* ignore */ }
        }
        channel = null;
      },

      /**
       * The user chose to sign out here: tell every other tab. This tab is already
       * leaving the page, so it does not get the "please sign in again" prompt.
       */
      signOut() {
        if (ended) return;
        ended = true;
        tracking = false;
        store.remove(config.storageKey);
        broadcast(REASONS.SIGNED_OUT);
      },

      /** Mark that a session now exists (after login) so later loss is reported. */
      markSignedIn() {
        ended = false;
        tracking = inspect().valid.length > 0;
        lastRefresh = now();
      },

      checkNow: checkNow,
      noteActivity: noteActivity,
      refreshNow() { return maybeRefresh(true); },
      isTracking() { return tracking; },
      hasEnded() { return ended; }
    };
  }

  // ---------------------------------------------------------------------------
  // Browser wiring: remove protected content and show a sign-in prompt.
  // ---------------------------------------------------------------------------

  function loginUrl() {
    const inPages = typeof location !== 'undefined' && /\/pages\//.test(location.pathname);
    return inPages ? 'login.html' : 'pages/login.html';
  }

  /** Replaces everything marked data-protected so a stale tab cannot keep showing it. */
  function clearProtectedContent(doc) {
    const nodes = doc.querySelectorAll('[data-protected]');
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      while (node.firstChild) node.removeChild(node.firstChild);
      node.setAttribute('aria-hidden', 'true');
    }
    return nodes.length;
  }

  function showSignInPrompt(doc, reason) {
    if (doc.getElementById('relief-session-ended')) return null;

    const overlay = doc.createElement('div');
    overlay.id = 'relief-session-ended';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'relief-session-ended-title');
    overlay.setAttribute('aria-describedby', 'relief-session-ended-text');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.75);padding:1rem;';

    const box = doc.createElement('div');
    box.style.cssText = 'max-width:420px;width:100%;background:#fff;color:#111827;border-radius:12px;padding:1.5rem;box-shadow:0 20px 40px rgba(0,0,0,0.3);text-align:center;font-family:inherit;';

    const title = doc.createElement('h2');
    title.id = 'relief-session-ended-title';
    title.textContent = 'Please sign in again';
    title.style.cssText = 'margin:0 0 0.5rem;font-size:1.25rem;';

    const text = doc.createElement('p');
    text.id = 'relief-session-ended-text';
    text.textContent = messageFor(reason) + ' For your privacy, the information on this page was removed. Sign in to continue.';
    text.style.cssText = 'margin:0 0 1.25rem;line-height:1.5;';

    const link = doc.createElement('a');
    link.href = loginUrl();
    link.textContent = 'Sign in';
    link.style.cssText = 'display:inline-block;padding:0.65rem 1.5rem;border-radius:8px;background:#0b6bcb;color:#fff;text-decoration:none;font-weight:600;';

    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(link);
    overlay.appendChild(box);
    doc.body.appendChild(overlay);
    link.focus();
    return overlay;
  }

  /** Called when a session that this tab had is gone. */
  function handleSessionEnded(reason, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return;
    clearProtectedContent(d);
    if (typeof updateAuthUI === 'function') {
      try { updateAuthUI(null); } catch (e) { /* nav not ready */ }
    }
    // Only interrupt pages that actually showed protected content.
    const hadProtected = d.querySelector('[data-protected]') !== null;
    if (hadProtected) showSignInPrompt(d, reason);
  }

  let pageWatcher = null;

  /** Starts the watcher for the current page. Safe to call more than once. */
  function init(options) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    if (pageWatcher) return pageWatcher;

    const opts = options || {};
    pageWatcher = createSessionWatcher({
      storage: window.localStorage,
      target: window,
      doc: document,
      config: opts.config,
      refresh: opts.refresh !== undefined ? opts.refresh : defaultRefresh,
      onEnded: (reason) => handleSessionEnded(reason, document)
    });
    pageWatcher.start();
    return pageWatcher;
  }

  /** Asks Firebase for a fresh token when a real sign-in exists. No-op otherwise. */
  function defaultRefresh() {
    if (typeof ReliefAPI !== 'undefined' && typeof ReliefAPI.refreshSession === 'function') {
      return ReliefAPI.refreshSession();
    }
    return Promise.resolve();
  }

  /** Used by the sign-out button so other tabs hear about it before storage is cleared. */
  function signOutEverywhere() {
    if (pageWatcher) {
      pageWatcher.signOut();
      return true;
    }
    return false;
  }

  /** After login/signup on this page, start reporting a later loss of the session. */
  function markSignedIn() {
    if (pageWatcher) pageWatcher.markSignedIn();
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
    else init();
  }

  return {
    DEFAULTS,
    REASONS,
    resolveConfig,
    evaluateSession,
    messageFor,
    createSessionWatcher,
    clearProtectedContent,
    showSignInPrompt,
    handleSessionEnded,
    init,
    signOutEverywhere,
    markSignedIn
  };
});
