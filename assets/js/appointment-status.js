/**
 * Relief Healthcare Platform - Appointment request status
 *
 * The life of an appointment request and who may move it:
 *
 *   submitted --provider--> under_review --provider--> confirmed
 *       |                        |   \                      |
 *       |                        |    +--provider--> declined (end)
 *       +--provider--> declined  |                          |
 *       |                        |                          |
 *       +--patient---> cancelled <--patient / provider------+   (end)
 *
 * Only the provider can say "confirmed" or "declined". This browser can never confirm a booking:
 * the only change it makes itself is a patient cancelling. The same table is enforced on the
 * server by firebase/firestore.rules and is described in docs/APPOINTMENT_STATUS.md.
 *
 * Pure functions, no DOM, so they run under node:test.
 * Implements Issue #62: Add appointment request status tracking and cancellation.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ReliefAppointmentStatus = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUSES = ['submitted', 'under_review', 'confirmed', 'declined', 'cancelled'];

  // A request still counts against a duplicate while it is in one of these.
  const OPEN_STATUSES = ['submitted', 'under_review', 'confirmed'];

  // Who may move a request from one status to another.
  const TRANSITIONS = {
    submitted: { patient: ['cancelled'], provider: ['under_review', 'declined'] },
    under_review: { patient: ['cancelled'], provider: ['confirmed', 'declined', 'cancelled'] },
    confirmed: { patient: ['cancelled'], provider: ['cancelled'] },
    declined: { patient: [], provider: [] },
    cancelled: { patient: [], provider: [] }
  };

  const INFO = {
    submitted: {
      label: 'Submitted',
      tone: 'neutral',
      description: 'Your request was submitted. It is not a booking and nothing is confirmed yet.'
    },
    under_review: {
      label: 'Under review',
      tone: 'neutral',
      description: 'The provider is looking at your request. It is not confirmed yet.'
    },
    confirmed: {
      label: 'Confirmed by provider',
      tone: 'good',
      description: 'The provider confirmed this appointment. Check the date and time they gave you.'
    },
    declined: {
      label: 'Declined by provider',
      tone: 'bad',
      description: 'The provider could not accept this request. You can send a new request for another date or time.'
    },
    cancelled: {
      label: 'Cancelled',
      tone: 'muted',
      description: 'This request was cancelled. You can send a new request at any time.'
    },
    unknown: {
      label: 'Status unknown',
      tone: 'neutral',
      description: 'We could not read the status of this request. Please contact the provider to check it.'
    }
  };

  const CANCEL_NOTE = 'Cancelling here updates this device only. Nothing is sent to the provider yet, so if you have already spoken to them, tell them directly.';

  // ---------- statuses ----------

  /**
   * Maps a stored value to a known status. Older requests used "requested", which is "submitted".
   * Anything unrecognised becomes "unknown" and is never shown as confirmed.
   */
  function normalizeStatus(value) {
    if (value === undefined || value === null || value === '' || value === 'requested') return 'submitted';
    return STATUSES.indexOf(value) !== -1 ? value : 'unknown';
  }

  function getInfo(status) {
    return INFO[normalizeStatus(status)] || INFO.unknown;
  }

  function isOpen(status) {
    return OPEN_STATUSES.indexOf(normalizeStatus(status)) !== -1;
  }

  function isFinal(status) {
    const s = normalizeStatus(status);
    return s === 'declined' || s === 'cancelled';
  }

  /** The only status a booking may be shown as "confirmed" under. */
  function isConfirmed(request) {
    return Boolean(request) && normalizeStatus(request.status) === 'confirmed';
  }

  // ---------- transitions ----------

  /**
   * Can `actor` ('patient' or 'provider') move a request from `from` to `to`?
   * Returns { ok: true } or { ok: false, reason }.
   */
  function checkTransition(from, to, actor) {
    const current = normalizeStatus(from);
    if (current === 'unknown') return { ok: false, reason: 'unknown-status' };
    if (STATUSES.indexOf(to) === -1) return { ok: false, reason: 'invalid-target' };
    if (actor !== 'patient' && actor !== 'provider') return { ok: false, reason: 'invalid-actor' };
    // A closed request says so, even when asked to "change" to the status it already has.
    if (isFinal(current)) return { ok: false, reason: 'final' };
    if (current === to) return { ok: false, reason: 'unchanged' };
    const allowed = TRANSITIONS[current][actor] || [];
    if (allowed.indexOf(to) === -1) return { ok: false, reason: actor === 'patient' ? 'patient-cannot' : 'not-allowed' };
    return { ok: true };
  }

  const REASON_TEXT = {
    'unknown-status': 'We could not read the status of this request, so it was not changed.',
    'invalid-target': 'That is not a valid status.',
    'invalid-actor': 'Only the patient or the provider can change a request.',
    unchanged: 'This request already has that status.',
    final: 'This request is already closed and cannot be changed.',
    'patient-cannot': 'Only the provider can do that. You can cancel the request if you no longer need it.',
    'not-allowed': 'That change is not allowed from the current status.',
    'not-found': 'We could not find that request on this device.'
  };

  function describeReason(reason) {
    return REASON_TEXT[reason] || 'The request could not be changed.';
  }

  // ---------- history ----------

  function historyOf(request) {
    return Array.isArray(request && request.statusHistory) ? request.statusHistory : [];
  }

  /** A request in its current shape: legacy "requested" becomes "submitted", history is filled in. */
  function normalizeRequest(request) {
    if (!request || typeof request !== 'object') return null;
    const status = normalizeStatus(request.status);
    const history = historyOf(request);
    return Object.assign({}, request, {
      status: status,
      statusHistory: history.length > 0
        ? history
        : (typeof request.createdAt === 'string' ? [{ status: 'submitted', at: request.createdAt, by: 'patient' }] : [])
    });
  }

  // ---------- cancelling ----------

  /**
   * The patient cancels a request. Returns a new list; the input is not changed.
   * { ok: true, requests, request } or { ok: false, reason, message, requests }.
   */
  function cancelRequest(requests, id, now) {
    const list = Array.isArray(requests) ? requests : [];
    const index = list.findIndex(function (r) { return r && String(r.id) === String(id); });
    if (index === -1) return { ok: false, reason: 'not-found', message: describeReason('not-found'), requests: list };

    const current = list[index];
    const check = checkTransition(current.status, 'cancelled', 'patient');
    if (!check.ok) return { ok: false, reason: check.reason, message: describeReason(check.reason), requests: list };

    const at = (now instanceof Date ? now : new Date()).toISOString();
    const updated = Object.assign({}, normalizeRequest(current), {
      status: 'cancelled',
      cancelledAt: at
    });
    updated.statusHistory = historyOf(normalizeRequest(current)).concat({ status: 'cancelled', at: at, by: 'patient' });

    const next = list.slice();
    next[index] = updated;
    return { ok: true, requests: next, request: updated };
  }

  /**
   * Applies a status change that came from the provider's side (a server answer).
   * Never call this with anything that was not verified by a server. It exists so the page
   * follows the same rules as the server rules when a backend is connected.
   */
  function applyProviderUpdate(requests, id, newStatus, at) {
    const list = Array.isArray(requests) ? requests : [];
    const index = list.findIndex(function (r) { return r && String(r.id) === String(id); });
    if (index === -1) return { ok: false, reason: 'not-found', message: describeReason('not-found'), requests: list };

    const check = checkTransition(list[index].status, newStatus, 'provider');
    if (!check.ok) return { ok: false, reason: check.reason, message: describeReason(check.reason), requests: list };

    const when = typeof at === 'string' ? at : new Date().toISOString();
    const base = normalizeRequest(list[index]);
    const updated = Object.assign({}, base, {
      status: newStatus,
      statusHistory: base.statusHistory.concat({ status: newStatus, at: when, by: 'provider' })
    });
    const next = list.slice();
    next[index] = updated;
    return { ok: true, requests: next, request: updated };
  }

  // ---------- reference identifier ----------

  // No 0/O or 1/I so a reference can be read out over the phone.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /**
   * A short reference such as RQ-7K3M-9P2X. It is random: it holds no name, email, phone number,
   * date or doctor, so it is safe to quote when contacting a provider.
   * `randomBytes` is for tests; by default the browser's secure random source is used.
   */
  function newReference(randomBytes) {
    let bytes;
    if (randomBytes) {
      bytes = randomBytes(8);
    } else if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
    } else {
      bytes = Array.from({ length: 8 }, function () { return Math.floor(Math.random() * 256); });
    }
    const chars = Array.from(bytes, function (b) { return ALPHABET[b % ALPHABET.length]; });
    return 'RQ-' + chars.slice(0, 4).join('') + '-' + chars.slice(4, 8).join('');
  }

  /** What to show as the reference. Older requests had long ids, so show a short tail of those. */
  function displayReference(id) {
    const text = String(id === undefined || id === null ? '' : id);
    if (/^RQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(text)) return text;
    const tail = text.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
    return tail ? 'RQ-' + tail.slice(0, 4) + '-' + tail.slice(4).padEnd(4, '0') : 'RQ-0000-0000';
  }

  // ---------- list for display ----------

  /** Newest first. Only fields that are safe to show: no email, phone or notes. */
  function toDisplayList(requests) {
    return (Array.isArray(requests) ? requests : [])
      .map(normalizeRequest)
      .filter(Boolean)
      .map(function (r) {
        const info = getInfo(r.status);
        return {
          id: r.id,
          reference: displayReference(r.id),
          status: r.status,
          statusLabel: info.label,
          statusDescription: info.description,
          tone: info.tone,
          doctorName: r.doctorName || 'Provider',
          specialty: r.specialty || '',
          preferredDate: r.preferredDate || '',
          preferredWindow: r.preferredWindow || '',
          createdAt: r.createdAt || '',
          canCancel: checkTransition(r.status, 'cancelled', 'patient').ok,
          confirmed: isConfirmed(r)
        };
      })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  return {
    STATUSES,
    OPEN_STATUSES,
    TRANSITIONS,
    CANCEL_NOTE,
    normalizeStatus,
    getInfo,
    isOpen,
    isFinal,
    isConfirmed,
    checkTransition,
    describeReason,
    normalizeRequest,
    cancelRequest,
    applyProviderUpdate,
    newReference,
    displayReference,
    toDisplayList
  };
});
