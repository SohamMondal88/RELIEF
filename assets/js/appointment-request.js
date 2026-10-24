/**
 * Relief - Appointment request helpers
 *
 * Pure functions used by the appointment page: validate the form, build the
 * request record that gets stored, detect duplicates and save without throwing.
 * A request is only a request. Its status is always "requested" until a
 * provider confirms it, which this static site cannot do.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefAppointmentRequest = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'relief_appointment_requests';
  var MAX_DAYS_AHEAD = 60;
  var MAX_NOTES = 500;
  var MAX_STORED = 50;

  // Windows are preferences, not bookable slots. "ends" is the hour (24h clock)
  // after which a window is over for the current day.
  var TIME_WINDOWS = {
    morning: { label: 'Morning (8 am to 12 pm)', ends: 12 },
    afternoon: { label: 'Afternoon (12 pm to 5 pm)', ends: 17 },
    evening: { label: 'Evening (5 pm to 9 pm)', ends: 21 }
  };

  var MESSAGES = {
    doctor: 'Select a doctor first. Go back to the doctors page and choose one.',
    date: 'Choose a preferred date.',
    datePast: 'The date cannot be in the past. Choose today or a later date.',
    dateFar: 'Choose a date within the next ' + MAX_DAYS_AHEAD + ' days.',
    timeWindow: 'Choose a preferred time window.',
    timeWindowPast: 'That time window has already ended today. Choose a later window or another date.',
    name: 'Enter your full name (2 to 100 characters).',
    email: 'Enter a valid email address, for example name@example.com.',
    phone: 'Enter a valid phone number, for example +91 98765 43210.',
    notes: 'Notes must be ' + MAX_NOTES + ' characters or fewer.',
    consent: 'Please agree to the privacy policy so we can share these details with the provider.'
  };

  // Order matches the on-page order, so the first bad field gets focus.
  var FIELD_ORDER = ['doctor', 'date', 'timeWindow', 'name', 'email', 'phone', 'notes', 'consent'];

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toDateString(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Parses a strict YYYY-MM-DD into a local Date, or null if it is not a real day.
  function parseDate(value) {
    if (typeof value !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date;
  }

  // Accepts +91 / 91 / 0 prefixes with spaces, dashes, dots or brackets.
  // Returns "+91XXXXXXXXXX" for Indian mobiles, "+<digits>" for other
  // international numbers, or null when it is not a usable number.
  function normalizePhone(value) {
    if (typeof value !== 'string') return null;
    var raw = value.trim();
    if (!/^[+\d][\d\s\-().]*$/.test(raw)) return null;
    var hasPlus = raw.charAt(0) === '+';
    var digits = raw.replace(/\D/g, '');
    if (!hasPlus) {
      if (digits.length === 10) return /^[6-9]/.test(digits) ? '+91' + digits : null;
      if (digits.length === 11 && digits.charAt(0) === '0') {
        return /^[6-9]/.test(digits.slice(1)) ? '+91' + digits.slice(1) : null;
      }
      if (digits.length === 12 && digits.slice(0, 2) === '91') {
        return /^[6-9]/.test(digits.slice(2)) ? '+' + digits : null;
      }
      return null;
    }
    if (digits.slice(0, 2) === '91') {
      return digits.length === 12 && /^[6-9]/.test(digits.slice(2)) ? '+' + digits : null;
    }
    return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : null;
  }

  function isValidEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * Validates form input. Returns { valid, errors, firstInvalid } where errors
   * maps a field key to a message and firstInvalid is the first key in page order.
   * options.now lets tests pin the clock.
   */
  function validateRequest(input, options) {
    var data = input || {};
    var now = (options && options.now) ? options.now : new Date();
    var errors = {};

    var doctor = data.doctor;
    if (!doctor || typeof doctor !== 'object' || doctor.id === undefined || doctor.id === null || !asText(String(doctor.name || ''))) {
      errors.doctor = MESSAGES.doctor;
    }

    var date = parseDate(data.date);
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!asText(data.date)) {
      errors.date = MESSAGES.date;
    } else if (!date) {
      errors.date = MESSAGES.date;
    } else if (date < today) {
      errors.date = MESSAGES.datePast;
    } else if (date > new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_DAYS_AHEAD)) {
      errors.date = MESSAGES.dateFar;
    }

    var windowKey = data.timeWindow;
    if (typeof windowKey !== 'string' || !Object.prototype.hasOwnProperty.call(TIME_WINDOWS, windowKey)) {
      errors.timeWindow = MESSAGES.timeWindow;
    } else if (date && !errors.date && date.getTime() === today.getTime() && now.getHours() >= TIME_WINDOWS[windowKey].ends) {
      errors.timeWindow = MESSAGES.timeWindowPast;
    }

    var name = asText(data.name);
    if (name.length < 2 || name.length > 100) errors.name = MESSAGES.name;

    if (!isValidEmail(asText(data.email))) errors.email = MESSAGES.email;

    if (!normalizePhone(asText(data.phone))) errors.phone = MESSAGES.phone;

    if (asText(data.notes).length > MAX_NOTES) errors.notes = MESSAGES.notes;

    if (data.consent !== true) errors.consent = MESSAGES.consent;

    var firstInvalid = null;
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      if (errors[FIELD_ORDER[i]]) {
        firstInvalid = FIELD_ORDER[i];
        break;
      }
    }
    return { valid: firstInvalid === null, errors: errors, firstInvalid: firstInvalid };
  }

  /**
   * Builds the record to store from already validated input. Only the fields
   * needed to follow up are kept, and status is always "requested".
   */
  function buildRequest(input, options) {
    var check = validateRequest(input, options);
    if (!check.valid) {
      throw new Error('Cannot build an appointment request from invalid input: ' + check.firstInvalid);
    }
    var now = (options && options.now) ? options.now : new Date();
    var id = (options && options.id) ? options.id : 'req-' + now.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var notes = asText(input.notes);
    var request = {
      id: id,
      doctorId: input.doctor.id,
      doctorName: asText(String(input.doctor.name)),
      specialty: asText(String(input.doctor.specialty || '')),
      preferredDate: input.date,
      preferredWindow: input.timeWindow,
      patientName: asText(input.name),
      patientEmail: asText(input.email).toLowerCase(),
      patientPhone: normalizePhone(asText(input.phone)),
      consentGiven: true,
      createdAt: now.toISOString(),
      status: 'requested'
    };
    if (notes) request.notes = notes;
    return request;
  }

  /**
   * True when an open request for the same doctor, date and window already
   * exists for the same email or phone number.
   */
  function isDuplicate(existing, request) {
    if (!Array.isArray(existing) || !request) return false;
    return existing.some(function (item) {
      if (!item || item.status !== 'requested') return false;
      if (String(item.doctorId) !== String(request.doctorId)) return false;
      if (item.preferredDate !== request.preferredDate) return false;
      if (item.preferredWindow !== request.preferredWindow) return false;
      return (item.patientEmail && item.patientEmail === request.patientEmail) ||
        (item.patientPhone && item.patientPhone === request.patientPhone);
    });
  }

  // Reads stored requests; blocked storage or corrupt JSON gives an empty list.
  function loadRequests(storage) {
    try {
      var parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Saves a request without ever throwing. Returns { ok: true } or
   * { ok: false, reason } where reason is "duplicate" or "storage".
   */
  function saveRequest(storage, request) {
    var existing = loadRequests(storage);
    if (isDuplicate(existing, request)) return { ok: false, reason: 'duplicate' };
    existing.push(request);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(-MAX_STORED)));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'storage' };
    }
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    MAX_DAYS_AHEAD: MAX_DAYS_AHEAD,
    TIME_WINDOWS: TIME_WINDOWS,
    FIELD_ORDER: FIELD_ORDER,
    toDateString: toDateString,
    parseDate: parseDate,
    normalizePhone: normalizePhone,
    validateRequest: validateRequest,
    buildRequest: buildRequest,
    isDuplicate: isDuplicate,
    loadRequests: loadRequests,
    saveRequest: saveRequest
  };
}));
