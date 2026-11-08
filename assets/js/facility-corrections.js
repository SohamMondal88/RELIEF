/**
 * Relief - moderated community corrections for facility information.
 *
 * People can suggest a fix for a facility's hours, phone, address or services.
 * A suggestion goes into a review queue. It is NEVER written to the public
 * facility record by this code: a moderator has to approve it with evidence,
 * and even then the approved change is handed to the maintainers as a patch
 * (approvedPatch) to apply to assets/data/facilities.json by hand, following the
 * verification workflow. Nothing here touches the fields verified, source,
 * lastChecked or any review state of a facility.
 *
 * Where the queue lives:
 *   - ReliefAPI (the backend) when it is reachable. This is the real thing, and
 *     the only place rate limits and moderator permissions can truly be enforced.
 *   - A browser-only demo queue (localStorage), used only in demo mode (localhost,
 *     file://, or an explicit demo flag) and only when the backend could not be
 *     reached. Demo records are marked demo: true and are never sent anywhere.
 *     On any other host an unreachable backend means "cannot submit right now".
 *
 * Client checks here (validation, sanitising, rate limit, duplicate guard) are
 * there to help honest users and to cut noise. They can be bypassed, so the
 * backend must repeat all of them: see docs/FACILITY_CORRECTIONS.md.
 *
 * Pure functions plus a store that takes its dependencies, so it runs in node:test.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.FacilityCorrections = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEMO_QUEUE_KEY = 'relief_demo_facility_corrections';
  var SUBMISSION_LOG_KEY = 'relief_correction_submissions';

  // Status names are deliberately different from the facility review states
  // (pending/verified/stale/rejected) planned for the verification workflow.
  var STATUSES = ['pending', 'approved', 'rejected'];

  var FIELDS = {
    hours: { label: 'Opening hours', min: 3, max: 120 },
    phone: { label: 'Phone number', min: 7, max: 30 },
    address: { label: 'Address', min: 5, max: 200 },
    services: { label: 'Services', min: 2, max: 400 }
  };

  var LIMITS = {
    minIntervalMs: 30 * 1000,
    maxPerHour: 3,
    maxPerDay: 10,
    duplicateWindowMs: 7 * 24 * 60 * 60 * 1000,
    maxServices: 10,
    maxServiceLength: 60,
    maxSourceUrl: 300,
    maxContact: 100,
    maxActor: 60,
    maxNote: 500,
    minReason: 5,
    minEvidence: 10,
    maxDemoPending: 100
  };

  // ---- text ---------------------------------------------------------------

  // Removes HTML tags, control characters, invisible direction/zero-width marks and
  // stray angle brackets, and collapses whitespace. Output is still escaped wherever it is shown.
  function sanitizeText(value, max) {
    var text = String(value === null || value === undefined ? '' : value)
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ' ')
      .replace(/<\/?[a-zA-Z!][^>]*>/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (typeof max === 'number' && text.length > max) text = text.slice(0, max).trim();
    return text;
  }

  function parseServices(text) {
    var seen = {};
    var out = [];
    String(text === null || text === undefined ? '' : text).split(/[,;\n]/).forEach(function (part) {
      var item = sanitizeText(part, LIMITS.maxServiceLength);
      var key = item.toLowerCase();
      if (item && !seen[key]) {
        seen[key] = true;
        out.push(item);
      }
    });
    return out;
  }

  function normalizeForCompare(value) {
    if (Array.isArray(value)) {
      return value.map(function (v) { return normalizeForCompare(v); }).sort().join('|');
    }
    return String(value === null || value === undefined ? '' : value).toLowerCase().replace(/[\s\-().]+/g, ' ').trim();
  }

  function sameValue(a, b) {
    return normalizeForCompare(a) === normalizeForCompare(b);
  }

  function digitCount(text) {
    return (String(text).match(/\d/g) || []).length;
  }

  function cleanSourceUrl(raw) {
    var text = sanitizeText(raw, LIMITS.maxSourceUrl + 1);
    if (!text) return { value: '' };
    if (text.length > LIMITS.maxSourceUrl) return { error: 'The link is too long.' };
    var url;
    try {
      url = new URL(text);
    } catch (e) {
      return { error: 'Enter a full web address starting with http:// or https://.' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Enter a full web address starting with http:// or https://.' };
    if (url.username || url.password) return { error: 'Remove the user name or password from the link.' };
    if (url.hostname.indexOf('.') === -1) return { error: 'That web address does not look right.' };
    return { value: url.href };
  }

  function cleanContact(raw) {
    var text = sanitizeText(raw, LIMITS.maxContact + 1);
    if (!text) return { value: '' };
    if (text.length > LIMITS.maxContact) return { error: 'The contact detail is too long.' };
    var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
    var isPhone = /^[+\d][\d\s\-().]*$/.test(text) && digitCount(text) >= 7 && digitCount(text) <= 15;
    if (!isEmail && !isPhone) return { error: 'Enter an email address or a phone number, or leave this empty.' };
    return { value: text };
  }

  // ---- submission ---------------------------------------------------------

  function findFacility(facilities, id) {
    var list = Array.isArray(facilities) ? facilities : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  /**
   * input: { facilityId, field, proposedValue, sourceUrl, contact, website }
   * ctx:   { facilities }   normalized facility records (FacilityUtils.normalizeFacilities)
   * Returns { valid, errors, clean }. `website` is a hidden honeypot field: a
   * person never fills it, so a value means a bot.
   */
  function validateSubmission(input, ctx) {
    var data = input || {};
    var errors = {};
    var clean = {};

    if (data.website !== undefined && data.website !== null && String(data.website).trim() !== '') {
      return { valid: false, errors: { form: 'This could not be submitted.' }, clean: {}, spam: true };
    }

    var facility = findFacility(ctx && ctx.facilities, data.facilityId);
    if (!facility) {
      errors.facilityId = 'Choose a facility from the list.';
    } else {
      clean.facilityId = String(facility.id);
    }

    var field = typeof data.field === 'string' ? data.field : '';
    if (!Object.prototype.hasOwnProperty.call(FIELDS, field)) {
      errors.field = 'Choose what needs correcting: hours, phone, address or services.';
    } else {
      clean.field = field;
    }

    if (clean.field) {
      var spec = FIELDS[clean.field];
      if (clean.field === 'services') {
        var list = parseServices(data.proposedValue);
        if (list.length === 0) {
          errors.proposedValue = 'Enter at least one service. Separate several with commas.';
        } else if (list.length > LIMITS.maxServices) {
          errors.proposedValue = 'Enter at most ' + LIMITS.maxServices + ' services.';
        } else {
          clean.proposedValue = list;
        }
      } else {
        var text = sanitizeText(data.proposedValue);
        if (text.length < spec.min) {
          errors.proposedValue = 'Enter the correct ' + spec.label.toLowerCase() + ' (at least ' + spec.min + ' characters).';
        } else if (text.length > spec.max) {
          errors.proposedValue = 'Keep the ' + spec.label.toLowerCase() + ' under ' + spec.max + ' characters.';
        } else if (clean.field === 'phone' && (!/^[+\d][\d\s\-().]*$/.test(text) || digitCount(text) < 7 || digitCount(text) > 15)) {
          errors.proposedValue = 'Enter a phone number using digits, spaces, +, - and brackets (7 to 15 digits).';
        } else {
          clean.proposedValue = text;
        }
      }
    }

    if (facility && clean.field && clean.proposedValue !== undefined && !errors.proposedValue) {
      var current = facility[clean.field];
      if (current && sameValue(current, clean.proposedValue)) {
        errors.proposedValue = 'That is already what the directory shows.';
      }
    }

    var source = cleanSourceUrl(data.sourceUrl);
    if (source.error) errors.sourceUrl = source.error; else clean.sourceUrl = source.value;

    var contact = cleanContact(data.contact);
    if (contact.error) errors.contact = contact.error; else clean.contact = contact.value;

    return { valid: Object.keys(errors).length === 0, errors: errors, clean: clean };
  }

  // Same facility + field + value (ignoring case and spacing) gives the same fingerprint.
  function fingerprint(clean) {
    return [clean.facilityId, clean.field, normalizeForCompare(clean.proposedValue)].join('::');
  }

  /**
   * log: [{ at: ms, fingerprint }] of this browser's earlier submissions.
   * Returns { allowed, reason, retryAfterMs, message }. reason: 'too-fast' |
   * 'hourly' | 'daily' | 'duplicate'. Client-side only: it slows down a
   * careless double click or a loop, not a determined person.
   */
  function checkRateLimit(log, now, clean, limits) {
    var lim = Object.assign({}, LIMITS, limits || {});
    var entries = (Array.isArray(log) ? log : []).filter(function (e) {
      return e && typeof e.at === 'number' && isFinite(e.at) && e.at <= now + 60000;
    });
    var fp = clean ? fingerprint(clean) : null;

    if (fp) {
      var dup = entries.some(function (e) { return e.fingerprint === fp && now - e.at < lim.duplicateWindowMs; });
      if (dup) {
        return { allowed: false, reason: 'duplicate', retryAfterMs: 0, message: 'You already suggested this change. A moderator will look at it.' };
      }
    }
    var last = entries.reduce(function (max, e) { return Math.max(max, e.at); }, 0);
    if (last && now - last < lim.minIntervalMs) {
      return { allowed: false, reason: 'too-fast', retryAfterMs: lim.minIntervalMs - (now - last), message: 'Please wait a few seconds before sending another suggestion.' };
    }
    var hour = entries.filter(function (e) { return now - e.at < 60 * 60 * 1000; });
    if (hour.length >= lim.maxPerHour) {
      var oldestHour = hour.reduce(function (min, e) { return Math.min(min, e.at); }, Infinity);
      return { allowed: false, reason: 'hourly', retryAfterMs: 60 * 60 * 1000 - (now - oldestHour), message: 'That is the limit for this hour. Please try again later.' };
    }
    var day = entries.filter(function (e) { return now - e.at < 24 * 60 * 60 * 1000; });
    if (day.length >= lim.maxPerDay) {
      var oldestDay = day.reduce(function (min, e) { return Math.min(min, e.at); }, Infinity);
      return { allowed: false, reason: 'daily', retryAfterMs: 24 * 60 * 60 * 1000 - (now - oldestDay), message: 'That is the limit for today. Please try again tomorrow.' };
    }
    return { allowed: true, reason: null, retryAfterMs: 0, message: '' };
  }

  function copyValue(value) {
    return Array.isArray(value) ? value.slice() : value;
  }

  /**
   * Makes a pending correction from validated input. The facility's current
   * value is copied (a snapshot), so the moderator sees what the proposal was
   * measured against even if the directory changes later.
   */
  function buildCorrection(clean, facility, ctx) {
    var c = ctx || {};
    var now = typeof c.now === 'number' ? c.now : Date.now();
    var at = new Date(now).toISOString();
    return {
      id: c.id || ('cor_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
      facilityId: clean.facilityId,
      facilityName: facility ? String(facility.name) : '',
      field: clean.field,
      currentValue: copyValue(facility ? (facility[clean.field] === undefined ? null : facility[clean.field]) : null),
      proposedValue: copyValue(clean.proposedValue),
      sourceUrl: clean.sourceUrl || '',
      contact: clean.contact || '',
      status: 'pending',
      createdAt: at,
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      evidence: null,
      history: [{ seq: 1, at: at, action: 'submitted', by: 'public', note: '', evidence: '' }]
    };
  }

  // ---- moderation ---------------------------------------------------------

  function cloneRecord(record) {
    return Object.assign({}, record, {
      currentValue: copyValue(record.currentValue),
      proposedValue: copyValue(record.proposedValue),
      history: (record.history || []).map(function (h) { return Object.assign({}, h); })
    });
  }

  /**
   * The only way a correction changes status. Returns { ok, record, errors }
   * and never edits the record it is given.
   *   - only a pending correction can be decided; a decision is final
   *   - the moderator is named; the name goes in the log
   *   - approving needs evidence (what was checked, and where)
   *   - rejecting needs a reason
   *   - the reporter's contact detail is wiped on any decision
   *   - a history entry is appended, nothing earlier is changed
   * decision: { decision: 'approve' | 'reject', actor, reason, evidence }
   */
  function decide(record, decision, ctx) {
    var d = decision || {};
    var errors = {};
    if (!record || typeof record !== 'object' || STATUSES.indexOf(record.status) === -1) {
      return { ok: false, record: null, errors: { form: 'That correction could not be found.' } };
    }
    if (record.status !== 'pending') {
      return { ok: false, record: null, errors: { form: 'This correction was already ' + record.status + '. A decision cannot be changed.' } };
    }
    var kind = d.decision;
    if (kind !== 'approve' && kind !== 'reject') errors.decision = 'Choose approve or reject.';

    var actor = sanitizeText(d.actor, LIMITS.maxActor);
    if (actor.length < 2) errors.actor = 'Enter your name so the decision is logged.';

    var reason = sanitizeText(d.reason, LIMITS.maxNote);
    var evidence = sanitizeText(d.evidence, LIMITS.maxNote);
    if (kind === 'approve' && evidence.length < LIMITS.minEvidence) {
      errors.evidence = 'Approving needs evidence: say what you checked and where (at least ' + LIMITS.minEvidence + ' characters).';
    }
    if (kind === 'reject' && reason.length < LIMITS.minReason) {
      errors.reason = 'Rejecting needs a reason (at least ' + LIMITS.minReason + ' characters).';
    }
    if (Object.keys(errors).length) return { ok: false, record: null, errors: errors };

    var c = ctx || {};
    var now = typeof c.now === 'number' ? c.now : Date.now();
    var at = new Date(now).toISOString();
    var next = cloneRecord(record);
    var action = kind === 'approve' ? 'approved' : 'rejected';
    next.status = action;
    next.decidedAt = at;
    next.decidedBy = actor;
    next.decisionReason = reason || null;
    next.evidence = evidence || null;
    next.contact = '';
    next.history.push({
      seq: next.history.length + 1,
      at: at,
      action: action,
      by: actor,
      note: reason,
      evidence: evidence
    });
    return { ok: true, record: next, errors: {} };
  }

  // Every logged event across all corrections, newest first.
  function decisionLog(records) {
    var rows = [];
    (Array.isArray(records) ? records : []).forEach(function (r) {
      if (!r || !Array.isArray(r.history)) return;
      r.history.forEach(function (h) {
        rows.push({
          correctionId: r.id,
          facilityId: r.facilityId,
          facilityName: r.facilityName,
          field: r.field,
          seq: h.seq,
          at: h.at,
          action: h.action,
          by: h.by,
          note: h.note || '',
          evidence: h.evidence || ''
        });
      });
    });
    rows.sort(function (a, b) {
      if (a.at === b.at) return b.seq - a.seq;
      return a.at < b.at ? 1 : -1;
    });
    return rows;
  }

  /**
   * Approved corrections as a list of changes for the maintainers to apply to
   * assets/data/facilities.json. This only describes the change. `from` is the
   * value when the suggestion was made, so a maintainer can see if the record
   * has changed since. Nothing in this file applies it.
   */
  function approvedPatch(records) {
    return (Array.isArray(records) ? records : [])
      .filter(function (r) { return r && r.status === 'approved'; })
      .map(function (r) {
        return {
          correctionId: r.id,
          facilityId: r.facilityId,
          facilityName: r.facilityName,
          field: r.field,
          from: copyValue(r.currentValue),
          to: copyValue(r.proposedValue),
          evidence: r.evidence,
          sourceUrl: r.sourceUrl || '',
          approvedBy: r.decidedBy,
          approvedAt: r.decidedAt,
          applied: false
        };
      });
  }

  // ---- store --------------------------------------------------------------

  function StoreError(kind, message, errors) {
    var err = new Error(message);
    err.name = 'CorrectionError';
    err.kind = kind;
    err.errors = errors || {};
    return err;
  }

  var UNAVAILABLE_MESSAGE = 'Corrections cannot be sent right now because the review service is not reachable. Please try again later.';

  function readJson(storage, key, fallback) {
    try {
      var parsed = JSON.parse(storage.getItem(key));
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * deps: { api, storage, demo (boolean), now (fn), idFn (fn), facilities, limits }
   * Every method resolves to { ok, ... } and never rejects.
   */
  function createStore(deps) {
    var d = deps || {};
    var api = d.api || null;
    var storage = d.storage || null;
    var demo = d.demo === true;
    var clock = typeof d.now === 'function' ? d.now : function () { return Date.now(); };

    function hasApi(method) { return !!(api && typeof api[method] === 'function'); }

    function readQueue() {
      var data = storage ? readJson(storage, DEMO_QUEUE_KEY, []) : [];
      return Array.isArray(data) ? data.filter(function (r) { return r && STATUSES.indexOf(r.status) !== -1; }) : [];
    }

    function writeQueue(items) {
      return !!storage && writeJson(storage, DEMO_QUEUE_KEY, items);
    }

    function readLog() {
      var data = storage ? readJson(storage, SUBMISSION_LOG_KEY, []) : [];
      return Array.isArray(data) ? data : [];
    }

    function writeLog(entries) {
      // Keep it small: nothing older than a day matters for the limits, a week for duplicates.
      var cutoff = clock() - LIMITS.duplicateWindowMs;
      return !!storage && writeJson(storage, SUBMISSION_LOG_KEY, entries.filter(function (e) { return e && e.at > cutoff; }).slice(-50));
    }

    function unavailable(error) {
      var R = typeof ReliefResilience !== 'undefined' ? ReliefResilience : null;
      var info = R && error ? R.classify(error) : null;
      // Say what actually happened (offline, timeout, server) when we know it, with a reference for support.
      var message = info && info.kind !== 'unavailable' && info.kind !== 'unknown'
        ? info.title + '. ' + info.message + (info.requestId ? ' (Reference: ' + info.requestId + ')' : '')
        : UNAVAILABLE_MESSAGE;
      return { ok: false, kind: 'unavailable', message: message, retryable: !info || info.retryable, errors: {} };
    }

    var idempotencyKeys = {};
    function idempotencyKeyFor(fp) {
      if (!idempotencyKeys[fp]) {
        var R = typeof ReliefResilience !== 'undefined' ? ReliefResilience : null;
        idempotencyKeys[fp] = R ? R.newIdempotencyKey() : 'k-' + String(clock()) + '-' + Math.floor(Math.random() * 1e9);
      }
      return idempotencyKeys[fp];
    }
    function forgetIdempotencyKey(fp) { delete idempotencyKeys[fp]; }

    async function submit(input) {
      var checked = validateSubmission(input, { facilities: d.facilities });
      if (checked.spam) return { ok: false, kind: 'spam', message: checked.errors.form, errors: checked.errors };
      if (!checked.valid) return { ok: false, kind: 'invalid', message: 'Please fix the highlighted fields.', errors: checked.errors };

      var now = clock();
      var limit = checkRateLimit(readLog(), now, checked.clean, d.limits);
      if (!limit.allowed) {
        return { ok: false, kind: limit.reason === 'duplicate' ? 'duplicate' : 'rate-limited', message: limit.message, retryAfterMs: limit.retryAfterMs, errors: {} };
      }

      var record = function (mode, correction) {
        var log = readLog();
        log.push({ at: now, fingerprint: fingerprint(checked.clean) });
        writeLog(log);
        return { ok: true, mode: mode, demo: mode === 'demo', correction: correction };
      };

      if (hasApi('submitFacilityCorrection')) {
        try {
          // The same suggestion keeps the same key, so pressing "send" again after a failure
          // is recognised by the server as a repeat instead of a second submission.
          var idemKey = idempotencyKeyFor(fingerprint(checked.clean));
          var answer = await api.submitFacilityCorrection({
            facilityId: checked.clean.facilityId,
            field: checked.clean.field,
            proposedValue: checked.clean.proposedValue,
            sourceUrl: checked.clean.sourceUrl,
            contact: checked.clean.contact
          }, { idempotencyKey: idemKey });
          forgetIdempotencyKey(fingerprint(checked.clean));
          return record('server', answer);
        } catch (error) {
          if (error && error.code === 'rate-limited') {
            return { ok: false, kind: 'rate-limited', message: 'Too many suggestions. Please try again later.', errors: {} };
          }
          if (error && error.code === 'rejected') {
            return { ok: false, kind: 'invalid', message: 'The review service did not accept this suggestion.', errors: (error.details && error.details.errors) || {} };
          }
          if (!demo) return unavailable(error);
        }
      } else if (!demo) {
        return unavailable();
      }

      // Demo queue: this browser only.
      var queue = readQueue();
      var pending = queue.filter(function (r) { return r.status === 'pending'; });
      var fp = fingerprint(checked.clean);
      if (pending.some(function (r) { return fingerprint({ facilityId: r.facilityId, field: r.field, proposedValue: r.proposedValue }) === fp; })) {
        return { ok: false, kind: 'duplicate', message: 'This change is already waiting for review.', errors: {} };
      }
      if (pending.length >= LIMITS.maxDemoPending) {
        return { ok: false, kind: 'queue-full', message: 'The demo review queue is full.', errors: {} };
      }
      var facility = findFacility(d.facilities, checked.clean.facilityId);
      var correction = buildCorrection(checked.clean, facility, { now: now, id: typeof d.idFn === 'function' ? d.idFn() : undefined });
      correction.demo = true;
      queue.push(correction);
      if (!writeQueue(queue)) {
        return { ok: false, kind: 'storage', message: 'Browser storage is unavailable, so the demo suggestion could not be saved.', errors: {} };
      }
      return record('demo', correction);
    }

    // filter: { status }
    async function list(filter) {
      var status = filter && filter.status && filter.status !== 'all' ? filter.status : null;
      if (hasApi('listFacilityCorrections')) {
        try {
          var items = await api.listFacilityCorrections(status ? { status: status } : {});
          var rows = Array.isArray(items) ? items : (items && Array.isArray(items.corrections) ? items.corrections : null);
          if (rows) {
            return { ok: true, mode: 'server', demo: false, items: rows.filter(function (r) { return r && STATUSES.indexOf(r.status) !== -1; }) };
          }
        } catch (error) {
          if (error && (error.code === 'unauthenticated' || error.code === 'forbidden')) {
            return { ok: false, kind: error.code, message: 'You need a moderator account to review corrections.', errors: {} };
          }
          if (!demo) return unavailable();
        }
        if (!demo) return unavailable();
      } else if (!demo) {
        return unavailable();
      }
      var all = readQueue();
      return { ok: true, mode: 'demo', demo: true, items: status ? all.filter(function (r) { return r.status === status; }) : all };
    }

    // decision: { decision, actor, reason, evidence }
    async function review(id, decision) {
      var dec = decision || {};
      if (hasApi('reviewFacilityCorrection')) {
        // Check the same rules the server will enforce so the user gets a clear message first.
        var pre = decide({ status: 'pending' }, dec, { now: clock() });
        if (!pre.ok && (pre.errors.decision || pre.errors.evidence || pre.errors.reason)) {
          return { ok: false, kind: 'invalid', message: 'Please fix the highlighted fields.', errors: pre.errors };
        }
        try {
          // The server names the moderator from their login. The page does not send an actor.
          var answer = await api.reviewFacilityCorrection(id, {
            decision: dec.decision,
            reason: sanitizeText(dec.reason, LIMITS.maxNote),
            evidence: sanitizeText(dec.evidence, LIMITS.maxNote)
          });
          return { ok: true, mode: 'server', demo: false, correction: answer };
        } catch (error) {
          if (error && (error.code === 'unauthenticated' || error.code === 'forbidden')) {
            return { ok: false, kind: error.code, message: 'You need a moderator account to review corrections.', errors: {} };
          }
          if (error && error.code === 'rejected') {
            return { ok: false, kind: 'invalid', message: 'The review service did not accept this decision.', errors: (error.details && error.details.errors) || {} };
          }
          if (!demo) return unavailable();
        }
      } else if (!demo) {
        return unavailable();
      }

      var queue = readQueue();
      var index = -1;
      for (var i = 0; i < queue.length; i++) { if (queue[i].id === id) { index = i; break; } }
      if (index === -1) return { ok: false, kind: 'not-found', message: 'That correction could not be found.', errors: {} };
      var result = decide(queue[index], dec, { now: clock() });
      if (!result.ok) {
        return { ok: false, kind: result.errors.form ? 'final' : 'invalid', message: result.errors.form || 'Please fix the highlighted fields.', errors: result.errors };
      }
      queue[index] = result.record;
      if (!writeQueue(queue)) return { ok: false, kind: 'storage', message: 'Browser storage is unavailable, so the decision could not be saved.', errors: {} };
      return { ok: true, mode: 'demo', demo: true, correction: result.record };
    }

    return { submit: submit, list: list, review: review };
  }

  return {
    DEMO_QUEUE_KEY: DEMO_QUEUE_KEY,
    SUBMISSION_LOG_KEY: SUBMISSION_LOG_KEY,
    STATUSES: STATUSES.slice(),
    FIELDS: FIELDS,
    LIMITS: LIMITS,
    UNAVAILABLE_MESSAGE: UNAVAILABLE_MESSAGE,
    sanitizeText: sanitizeText,
    parseServices: parseServices,
    validateSubmission: validateSubmission,
    fingerprint: fingerprint,
    checkRateLimit: checkRateLimit,
    buildCorrection: buildCorrection,
    decide: decide,
    decisionLog: decisionLog,
    approvedPatch: approvedPatch,
    createStore: createStore
  };
}));
