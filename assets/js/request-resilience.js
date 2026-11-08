/**
 * RELIEF request resilience
 *
 * One place that decides how a failed request is described, retried, logged and shown:
 *
 *  - classify(error)      turns any failure into { kind, title, message, action, retryable, requestId }
 *  - retry(fn, options)   bounded retries with backoff, only for failures that are safe to repeat
 *  - newIdempotencyKey()  a key a caller keeps across retries so a repeated POST is not a second submission
 *  - extractRequestId()   reads a request id from response headers or body when the backend sends one
 *  - redact()/logError()  operational logging that never contains passwords, tokens or health details
 *  - renderState()        the same loading / empty / success / error markup on every page
 *  - degrade()            runs a non-critical feature and falls back instead of breaking the page
 *
 * Retry rules (see docs/ERROR_HANDLING.md):
 *  - Reads (GET/HEAD) retry on timeouts, network errors, 502/503/504 and short 429s.
 *  - Writes (POST/PUT/PATCH/DELETE) are never retried automatically after the request may have
 *    reached the server. They carry an Idempotency-Key, so the user's own "Try again" reuses the
 *    same key and the backend can recognise the repeat. A write is retried automatically only when
 *    it never left the browser (offline) or the server said it did nothing (429 / 503 with Retry-After).
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefResilience = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KINDS = {
    OFFLINE: 'offline',
    TIMEOUT: 'timeout',
    UNAUTHENTICATED: 'unauthenticated',
    FORBIDDEN: 'forbidden',
    RATE_LIMITED: 'rate-limited',
    REJECTED: 'rejected', // other 4xx: the request itself is wrong, retrying cannot help
    SERVER: 'server', // 5xx
    UNAVAILABLE: 'unavailable', // not configured, bad answer, or unreachable for an unknown reason
    UNKNOWN: 'unknown'
  };

  var DEFAULT_RETRY = { retries: 2, baseDelayMs: 400, maxDelayMs: 4000, maxRetryAfterMs: 5000 };

  // Overridable so tests (and slow-network deployments) do not need real waiting.
  var runtime = {
    sleep: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); },
    random: Math.random,
    isOnline: function () {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    },
    log: null // set by configure(); defaults to console
  };

  function configure(overrides) {
    var o = overrides || {};
    if (typeof o.sleep === 'function') runtime.sleep = o.sleep;
    if (typeof o.random === 'function') runtime.random = o.random;
    if (typeof o.isOnline === 'function') runtime.isOnline = o.isOnline;
    if (o.log === null || typeof o.log === 'function') runtime.log = o.log;
  }

  function isIdempotentMethod(method) {
    var m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  }

  // ---- Messages ---------------------------------------------------------

  var MESSAGES = {
    offline: {
      title: 'You are offline',
      message: 'Check your internet connection. We will not lose what you entered.',
      action: 'retry'
    },
    timeout: {
      title: 'This is taking too long',
      message: 'The server did not answer in time. Try again in a moment.',
      action: 'retry'
    },
    unauthenticated: {
      title: 'Please sign in',
      message: 'Your session has ended or you are not signed in. Sign in and try again.',
      action: 'sign-in'
    },
    forbidden: {
      title: 'Not allowed',
      message: 'Your account does not have access to this. If you think it should, contact support.',
      action: 'contact-support'
    },
    'rate-limited': {
      title: 'Too many requests',
      message: 'Please wait a little while before trying again.',
      action: 'wait'
    },
    rejected: {
      title: 'We could not accept that',
      message: 'Check what you entered and try again.',
      action: 'fix-input'
    },
    server: {
      title: 'Something went wrong on our side',
      message: 'This is not caused by anything you did. Try again shortly.',
      action: 'retry'
    },
    unavailable: {
      title: 'Service unavailable',
      message: 'We could not reach this service right now. Try again shortly.',
      action: 'retry'
    },
    unknown: {
      title: 'Something went wrong',
      message: 'An unexpected problem occurred. Try again, and contact support if it keeps happening.',
      action: 'retry'
    }
  };

  var EMERGENCY_NOTE = 'If this is an emergency, call your local emergency number now.';

  function kindFromStatus(status) {
    if (status === 401) return KINDS.UNAUTHENTICATED;
    if (status === 403) return KINDS.FORBIDDEN;
    if (status === 408) return KINDS.TIMEOUT;
    if (status === 429) return KINDS.RATE_LIMITED;
    if (status >= 400 && status < 500) return KINDS.REJECTED;
    if (status >= 500) return KINDS.SERVER;
    return null;
  }

  /**
   * Describes a failure for the user.
   * Accepts an Error from ReliefAPI (code / reason / status / requestId), a { status } object,
   * a fetch TypeError or an AbortError. Never throws and never includes raw server text.
   */
  function classify(input) {
    var err = input || {};
    var kind = KINDS.UNKNOWN;
    var status = typeof err.status === 'number' ? err.status : null;

    if (err.reason === 'offline' || (err.kind === KINDS.OFFLINE)) kind = KINDS.OFFLINE;
    else if (err.reason === 'timeout' || err.name === 'AbortError' || err.name === 'TimeoutError' || err.kind === KINDS.TIMEOUT) kind = KINDS.TIMEOUT;
    else if (err.code === 'unauthenticated') kind = KINDS.UNAUTHENTICATED;
    else if (err.code === 'forbidden') kind = KINDS.FORBIDDEN;
    else if (err.code === 'rate-limited') kind = KINDS.RATE_LIMITED;
    else if (err.code === 'rejected') kind = KINDS.REJECTED;
    else if (status !== null && kindFromStatus(status)) kind = kindFromStatus(status);
    else if (err.code === 'backend-unavailable') kind = KINDS.UNAVAILABLE;
    else if (err.name === 'TypeError' && /fetch|network|load failed/i.test(String(err.message || ''))) {
      kind = runtime.isOnline() ? KINDS.UNAVAILABLE : KINDS.OFFLINE;
    }

    var text = MESSAGES[kind];
    var retryAfterMs = typeof err.retryAfterMs === 'number' ? err.retryAfterMs : null;
    return {
      kind: kind,
      title: text.title,
      message: text.message,
      action: text.action,
      retryable: text.action === 'retry' || text.action === 'wait',
      status: status,
      retryAfterMs: retryAfterMs,
      requestId: sanitizeRequestId(err.requestId)
    };
  }

  /** The line support needs: a short code that can be quoted without exposing anything private. */
  function supportReference(info) {
    var parts = [];
    if (info && info.kind) parts.push(info.kind);
    if (info && info.status) parts.push(String(info.status));
    var ref = parts.join('-');
    if (info && info.requestId) ref += (ref ? ' ' : '') + 'ref ' + info.requestId;
    return ref;
  }

  // ---- Request ids ------------------------------------------------------

  var REQUEST_ID_HEADERS = ['x-request-id', 'x-correlation-id', 'x-amzn-requestid', 'cf-ray'];

  // Only short, boring identifiers are kept. Anything else (for example a token that ended up
  // in a header by mistake) is dropped rather than shown or logged.
  function sanitizeRequestId(value) {
    if (typeof value !== 'string') return null;
    var v = value.trim();
    if (v.length < 6 || v.length > 64) return null;
    if (!/^[A-Za-z0-9._:-]+$/.test(v)) return null;
    if (/^eyJ[A-Za-z0-9_-]{10,}\./.test(v)) return null; // looks like a JWT
    return v;
  }

  /** Reads a request id from response headers, or from a JSON body field when exposed there. */
  function extractRequestId(response, body) {
    var headers = response && response.headers;
    if (headers && typeof headers.get === 'function') {
      for (var i = 0; i < REQUEST_ID_HEADERS.length; i++) {
        var id = sanitizeRequestId(headers.get(REQUEST_ID_HEADERS[i]));
        if (id) return id;
      }
    }
    if (body && typeof body === 'object') {
      var fromBody = sanitizeRequestId(body.requestId || body.request_id);
      if (fromBody) return fromBody;
    }
    return null;
  }

  /** Retry-After as milliseconds (seconds or HTTP date), or null. */
  function parseRetryAfter(value, now) {
    if (value === null || value === undefined || value === '') return null;
    var text = String(value).trim();
    if (/^\d+$/.test(text)) return Math.min(parseInt(text, 10), 3600) * 1000;
    var when = Date.parse(text);
    if (isNaN(when)) return null;
    var wait = when - (typeof now === 'number' ? now : Date.now());
    return wait > 0 ? Math.min(wait, 3600 * 1000) : 0;
  }

  // ---- Idempotency ------------------------------------------------------

  var keyCounter = 0;
  function newIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    keyCounter += 1;
    var rand = '';
    for (var i = 0; i < 4; i++) rand += Math.floor(runtime.random() * 0xffff).toString(16);
    return 'k-' + Date.now().toString(36) + '-' + keyCounter + '-' + rand;
  }

  // ---- Retry ------------------------------------------------------------

  /**
   * Whether `error` may be repeated automatically.
   * `error.reason`: 'offline' | 'timeout' | 'network' | 'server' | 'rate-limited' | ...
   * `error.sent`: false when the request provably never left the browser.
   */
  function isSafeToRetry(error, method, hasIdempotencyGuarantee) {
    if (!error) return false;
    var status = typeof error.status === 'number' ? error.status : null;
    if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    if (error.code === 'unauthenticated' || error.code === 'forbidden' || error.code === 'rejected') return false;
    if (error.code === 'backend-unavailable' && error.reason === 'not-configured') return false;
    if (error.code === 'backend-unavailable' && error.reason === 'bad-config') return false;
    if (error.code === 'backend-unavailable' && error.reason === 'bad-answer') return false;

    if (isIdempotentMethod(method)) return true;
    if (hasIdempotencyGuarantee) return true;
    // A write: only when we know the server did not act on it.
    if (error.sent === false) return true;
    if (status === 429 || status === 503) return typeof error.retryAfterMs === 'number';
    return false;
  }

  function backoffDelay(attempt, opts, error) {
    if (error && typeof error.retryAfterMs === 'number') return error.retryAfterMs;
    var exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * Math.pow(2, attempt));
    // "Full jitter" keeps many tabs from retrying in lockstep.
    return Math.floor(exp / 2 + runtime.random() * (exp / 2));
  }

  /**
   * Runs fn() and repeats it for transient failures.
   * options: { method, retries, baseDelayMs, maxDelayMs, maxRetryAfterMs, idempotent, shouldRetry, onRetry }
   *   idempotent: true when the call carries an idempotency key the backend honours.
   * Resolves with fn's result or rejects with the LAST error (with `attempts` set on it).
   */
  async function retry(fn, options) {
    var opts = Object.assign({}, DEFAULT_RETRY, options || {});
    var attempt = 0;
    for (;;) {
      try {
        return await fn(attempt);
      } catch (error) {
        if (error && typeof error === 'object') error.attempts = attempt + 1;
        var decide = typeof opts.shouldRetry === 'function'
          ? opts.shouldRetry(error, attempt)
          : isSafeToRetry(error, opts.method, opts.idempotent);
        var delay = decide ? backoffDelay(attempt, opts, error) : 0;
        var tooLong = typeof error.retryAfterMs === 'number' && error.retryAfterMs > opts.maxRetryAfterMs;
        if (!decide || attempt >= opts.retries || tooLong) throw error;
        if (!runtime.isOnline() && !(error && error.reason === 'offline')) throw error;
        if (typeof opts.onRetry === 'function') {
          try { opts.onRetry({ attempt: attempt + 1, delayMs: delay, error: classify(error) }); } catch (e) { /* ignore */ }
        }
        await runtime.sleep(delay);
        attempt += 1;
      }
    }
  }

  // ---- Logging without sensitive data ------------------------------------

  var SENSITIVE_KEY = /pass(word)?|pwd|token|secret|authorization|auth|cookie|session|api[-_]?key|bearer|credential|otp|pin\b|ssn|email|phone|mobile|address|dob|birth|name|symptom|diagnos|condition|medic|allerg|prescri|health|patient|note|message|body|reason|evidence|proposedvalue|contact/i;

  function redactString(text) {
    return String(text)
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[redacted-jwt]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
      .replace(/([?&](?:token|key|api_key|apikey|password|pass|auth|session|code|email)=)[^&#\s]*/gi, '$1[redacted]')
      .replace(/\+?\d[\d\s().-]{8,}\d/g, '[redacted-number]');
  }

  /** A copy of `value` that is safe to log: sensitive keys and token-like strings are replaced. */
  function redact(value, depth) {
    var level = depth || 0;
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value).slice(0, 200);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (level >= 3) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 5).map(function (v) { return redact(v, level + 1); });
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).slice(0, 20).forEach(function (k) {
        out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(value[k], level + 1);
      });
      return out;
    }
    return '[' + typeof value + ']';
  }

  /** Strips the query string and fragment (they can carry tokens or search terms) and any credentials. */
  function safeUrl(url) {
    var text = String(url || '');
    return redactString(text.split('#')[0].split('?')[0].replace(/\/\/[^/@]*@/, '//'));
  }

  var recent = []; // last few safe entries, for a "copy diagnostics" button
  var MAX_RECENT = 20;

  /**
   * Logs an operational error. Records only: where it happened, what kind of failure, status,
   * attempts, request id and the URL path. Never the request body, headers, user input or the
   * server's error text.
   */
  function logError(context, error, extra) {
    var info = classify(error);
    var entry = {
      at: new Date().toISOString(),
      context: String(context || 'request').slice(0, 60),
      kind: info.kind,
      status: info.status,
      requestId: info.requestId,
      attempts: error && typeof error.attempts === 'number' ? error.attempts : 1
    };
    if (extra && typeof extra === 'object') {
      var safe = redact(extra);
      Object.keys(safe).forEach(function (k) { if (!(k in entry)) entry[k] = safe[k]; });
    }
    recent.push(entry);
    if (recent.length > MAX_RECENT) recent.shift();
    try {
      if (typeof runtime.log === 'function') runtime.log(entry);
      else if (typeof console !== 'undefined' && console.warn) console.warn('[relief] ' + entry.context, entry);
    } catch (e) { /* logging must never break the page */ }
    return entry;
  }

  function recentErrors() { return recent.slice(); }
  function clearRecentErrors() { recent.length = 0; }

  /** Text a user can paste to support. Built only from already-redacted entries. */
  function diagnosticsText() {
    return recent.map(function (e) {
      return [e.at, e.context, e.kind, e.status || '-', e.requestId || '-', 'attempts=' + e.attempts].join(' | ');
    }).join('\n');
  }

  // ---- Non-critical features ----------------------------------------------

  /**
   * Runs a non-critical feature (map, distance sorting, analytics-like extras). If it fails, logs
   * a redacted entry, runs onFallback with a description and resolves with `fallbackValue`, so the
   * rest of the page keeps working.
   */
  async function degrade(name, fn, options) {
    var opts = options || {};
    try {
      return await fn();
    } catch (error) {
      logError('degraded:' + name, error);
      if (typeof opts.onFallback === 'function') {
        try { opts.onFallback(classify(error)); } catch (e) { /* ignore */ }
      }
      return opts.fallbackValue;
    }
  }

  // ---- Shared state markup ------------------------------------------------

  var STATES = ['loading', 'empty', 'success', 'error'];

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Describes one of the four states as plain data, so it can be tested without a DOM.
   * model: { state, message, title, error (classify() result), actionLabel, emergency }
   */
  function describeState(model) {
    var m = model || {};
    var state = STATES.indexOf(m.state) !== -1 ? m.state : 'error';
    if (state === 'loading') {
      return { state: state, role: 'status', live: 'polite', title: m.title || '', message: m.message || 'Loading...', retry: false };
    }
    if (state === 'empty') {
      return { state: state, role: 'status', live: 'polite', title: m.title || 'Nothing to show yet', message: m.message || 'There are no results.', retry: false };
    }
    if (state === 'success') {
      return { state: state, role: 'status', live: 'polite', title: m.title || '', message: m.message || 'Done.', retry: false };
    }
    var info = m.error ? (m.error.kind && m.error.title ? m.error : classify(m.error)) : classify({});
    return {
      state: 'error',
      role: 'alert',
      live: 'assertive',
      title: m.title || info.title,
      message: m.message || info.message,
      retry: info.retryable,
      action: info.action,
      reference: supportReference(info),
      emergency: Boolean(m.emergency)
    };
  }

  /**
   * Renders a state into `container` (a DOM element). Returns the retry button, if any.
   * onRetry runs when the button is pressed; the button is disabled while it runs so a double
   * click cannot start two requests.
   */
  function renderState(container, model, onRetry) {
    if (!container || typeof document === 'undefined') return null;
    var d = describeState(model);
    container.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'state state-' + d.state;
    box.setAttribute('data-state', d.state);
    box.setAttribute('role', d.role);
    box.setAttribute('aria-live', d.live);
    if (d.state === 'loading') box.setAttribute('aria-busy', 'true');

    var html = '';
    if (d.title) html += '<p class="state-title"><strong>' + escapeHtml(d.title) + '</strong></p>';
    html += '<p class="state-message">' + escapeHtml(d.message) + '</p>';
    if (d.state === 'error' && d.emergency) html += '<p class="state-emergency">' + escapeHtml(EMERGENCY_NOTE) + '</p>';
    if (d.state === 'error' && d.reference) html += '<p class="state-reference muted">Reference: ' + escapeHtml(d.reference) + '</p>';
    box.innerHTML = html;

    var button = null;
    if (d.state === 'error' && d.retry && typeof onRetry === 'function') {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-filter state-retry';
      button.textContent = (model && model.actionLabel) || 'Try again';
      button.addEventListener('click', function () {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        Promise.resolve().then(onRetry).catch(function () { /* the caller renders its own error */ });
      });
      box.appendChild(button);
    } else if (d.state === 'error' && d.action === 'sign-in') {
      var link = document.createElement('a');
      link.href = (model && model.signInHref) || 'login.html';
      link.className = 'btn-filter state-action';
      link.textContent = 'Sign in';
      box.appendChild(link);
    }
    container.appendChild(box);
    return button;
  }

  return {
    KINDS: KINDS,
    DEFAULT_RETRY: DEFAULT_RETRY,
    EMERGENCY_NOTE: EMERGENCY_NOTE,
    configure: configure,
    classify: classify,
    supportReference: supportReference,
    sanitizeRequestId: sanitizeRequestId,
    extractRequestId: extractRequestId,
    parseRetryAfter: parseRetryAfter,
    newIdempotencyKey: newIdempotencyKey,
    isIdempotentMethod: isIdempotentMethod,
    isSafeToRetry: isSafeToRetry,
    retry: retry,
    redact: redact,
    safeUrl: safeUrl,
    logError: logError,
    recentErrors: recentErrors,
    clearRecentErrors: clearRecentErrors,
    diagnosticsText: diagnosticsText,
    degrade: degrade,
    describeState: describeState,
    renderState: renderState
  };
});
