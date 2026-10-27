/**
 * Relief Healthcare Platform - Public Form Guard
 *
 * Adds proportionate abuse protection to public forms (contact, login, signup):
 *  - sliding-window rate limit that survives page reloads
 *  - lock against concurrent / double submissions
 *  - honeypot field and minimum fill time for naive bots
 *  - generic, recoverable error messages that reveal no implementation details
 *
 * Important: this runs in the browser, so it only adds friction. It cannot stop a
 * determined attacker who calls the backend directly. Real enforcement has to live
 * where the data is accepted (Firebase Security Rules, App Check, Auth quotas).
 * See docs/FORM_PROTECTION.md.
 *
 * Implements Issue #56: Add rate limiting and abuse protection to public forms.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ReliefFormGuard = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_PREFIX = 'relief_formguard_';

  const DEFAULTS = {
    maxAttempts: 3, // attempts allowed inside one window
    windowMs: 60 * 1000, // sliding window length
    minFillMs: 1500, // faster than this after the form appeared is treated as a bot
    countFailuresOnly: false, // true for login: only failed attempts count
    honeypotField: 'website' // name of the hidden trap field
  };

  const REASONS = {
    BUSY: 'busy',
    BOT: 'bot',
    TOO_FAST: 'too-fast',
    RATE_LIMITED: 'rate-limited'
  };

  function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  /** Merge defaults, a global override object and per-guard options, ignoring bad values. */
  function resolveConfig(formId, options, globalConfig) {
    const fromGlobal = (globalConfig && globalConfig[formId]) || {};
    const merged = Object.assign({}, DEFAULTS, fromGlobal, options || {});
    return {
      maxAttempts: toPositiveInt(merged.maxAttempts, DEFAULTS.maxAttempts),
      windowMs: toPositiveInt(merged.windowMs, DEFAULTS.windowMs),
      minFillMs: Math.max(0, Number(merged.minFillMs) || 0),
      countFailuresOnly: Boolean(merged.countFailuresOnly),
      honeypotField: String(merged.honeypotField || DEFAULTS.honeypotField)
    };
  }

  /** localStorage wrapper that never throws and falls back to memory (private mode, quota, etc.). */
  function createSafeStorage(backing) {
    const memory = {};
    return {
      get(key) {
        try {
          if (backing) {
            const value = backing.getItem(key);
            if (value !== null) return value;
          }
        } catch (e) { /* fall through to memory */ }
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      set(key, value) {
        memory[key] = value;
        try {
          if (backing) backing.setItem(key, value);
        } catch (e) { /* memory copy is enough */ }
      },
      remove(key) {
        delete memory[key];
        try {
          if (backing) backing.removeItem(key);
        } catch (e) { /* ignore */ }
      }
    };
  }

  function formatWait(ms) {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    if (seconds < 60) return seconds + (seconds === 1 ? ' second' : ' seconds');
    const minutes = Math.ceil(seconds / 60);
    return minutes + (minutes === 1 ? ' minute' : ' minutes');
  }

  function buildMessage(reason, retryAfterMs) {
    switch (reason) {
      case REASONS.RATE_LIMITED:
        return 'Too many attempts. Please wait ' + formatWait(retryAfterMs) + ' and try again.';
      case REASONS.TOO_FAST:
        return 'That was a little quick. Please review the form and submit again.';
      case REASONS.BUSY:
        return 'Your request is already being sent. Please wait a moment.';
      default:
        return 'We could not submit the form. Please try again.';
    }
  }

  function createGuard(formId, options, env) {
    if (!formId) throw new Error('createGuard requires a formId');

    const runtime = env || {};
    const now = runtime.now || Date.now;
    const config = resolveConfig(
      formId,
      options,
      runtime.config !== undefined
        ? runtime.config
        : (typeof globalThis !== 'undefined' ? globalThis.ReliefFormGuardConfig : undefined)
    );
    const storage = createSafeStorage(
      runtime.storage !== undefined
        ? runtime.storage
        : (typeof localStorage !== 'undefined' ? localStorage : null)
    );
    const storageKey = STORAGE_PREFIX + formId;

    let inFlight = false;
    let shownAt = now();

    /** Attempts still inside the window. Drops corrupt entries and timestamps from the future. */
    function loadAttempts() {
      let parsed = [];
      try {
        parsed = JSON.parse(storage.get(storageKey) || '[]');
      } catch (e) {
        parsed = [];
      }
      if (!Array.isArray(parsed)) return [];
      const current = now();
      return parsed.filter(
        (t) => typeof t === 'number' && t <= current && current - t < config.windowMs
      );
    }

    function saveAttempts(attempts) {
      if (attempts.length === 0) storage.remove(storageKey);
      else storage.set(storageKey, JSON.stringify(attempts));
    }

    function recordAttempt() {
      const attempts = loadAttempts();
      attempts.push(now());
      saveAttempts(attempts);
    }

    /** Milliseconds until another attempt is allowed (0 when allowed now). */
    function retryAfter() {
      const attempts = loadAttempts();
      if (attempts.length < config.maxAttempts) return 0;
      const oldestCounting = attempts[attempts.length - config.maxAttempts];
      return Math.max(0, oldestCounting + config.windowMs - now());
    }

    function deny(reason, retryAfterMs) {
      return {
        ok: false,
        reason: reason,
        retryAfterMs: retryAfterMs || 0,
        message: buildMessage(reason, retryAfterMs || 0)
      };
    }

    return {
      config: config,

      /** Call when the form becomes visible so the minimum fill time can be measured. */
      markShown() {
        shownAt = now();
      },

      /** Read-only status, useful for disabling the button while limited. */
      status() {
        const wait = retryAfter();
        return { limited: wait > 0, retryAfterMs: wait, busy: inFlight };
      },

      /** Clear the counter, e.g. after a successful login. */
      reset() {
        storage.remove(storageKey);
      },

      /**
       * Run `submitFn` if allowed.
       * @param {Function} submitFn   async function that performs the real submission
       * @param {Object}   [fields]   { honeypot: string } value of the hidden trap field
       * @returns {Promise<{ok:boolean, reason?:string, retryAfterMs?:number, message?:string, value?:*}>}
       */
      async run(submitFn, fields) {
        if (inFlight) return deny(REASONS.BUSY);

        // Bots tend to fill every field, including the hidden one. Do not reveal why.
        if (fields && fields.honeypot) return deny(REASONS.BOT);

        const wait = retryAfter();
        if (wait > 0) return deny(REASONS.RATE_LIMITED, wait);

        if (config.minFillMs > 0 && now() - shownAt < config.minFillMs) {
          return deny(REASONS.TOO_FAST);
        }

        // Lock before the first await so two clicks in the same tick cannot both pass.
        inFlight = true;
        if (!config.countFailuresOnly) recordAttempt();

        try {
          const value = await submitFn();
          if (config.countFailuresOnly) storage.remove(storageKey);
          return { ok: true, value: value };
        } catch (error) {
          if (config.countFailuresOnly) recordAttempt();
          const limitedNow = retryAfter();
          const result = { ok: false, reason: 'failed', error: error, retryAfterMs: limitedNow };
          // Keep the original error message for the caller, but warn when the limit was just hit.
          result.message = limitedNow > 0
            ? buildMessage(REASONS.RATE_LIMITED, limitedNow)
            : (error && error.message) || buildMessage('failed');
          return result;
        } finally {
          inFlight = false;
        }
      }
    };
  }

  /** Adds an off-screen trap field that real users never see or tab into. */
  function attachHoneypot(form, fieldName) {
    if (!form || typeof document === 'undefined') return null;
    const name = fieldName || DEFAULTS.honeypotField;
    const existing = form.querySelector('input[name="' + name + '"]');
    if (existing) return existing;

    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.style.cssText = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;';

    const input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    input.tabIndex = -1;
    input.autocomplete = 'off';

    wrapper.appendChild(input);
    form.appendChild(wrapper);
    return input;
  }

  /** Shows (or clears) a polite-but-urgent message next to the submit button. */
  function showGuardMessage(form, message) {
    if (!form || typeof document === 'undefined') return;
    let box = form.querySelector('.form-guard-message');
    if (!message) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'form-guard-message';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin:0.75rem 0;padding:0.75rem 1rem;border-radius:8px;background:#fff4e5;color:#7a4100;border:1px solid #ffd8a8;font-size:0.9rem;';
      const submit = form.querySelector('button[type="submit"]');
      if (submit && submit.parentNode) submit.parentNode.insertBefore(box, submit);
      else form.appendChild(box);
    }
    box.textContent = message;
  }

  return {
    DEFAULTS,
    REASONS,
    createGuard,
    attachHoneypot,
    showGuardMessage,
    formatWait,
    resolveConfig,
    createSafeStorage
  };
});
