/**
 * Relief - shared email and phone checks.
 *
 * One place for the rules the forms used to paste into six files, so a value is judged the same way
 * on the contact form, the appointment form, the health event form, the facility correction form,
 * the newsletter box and the login/signup pages.
 *
 *   trim(value)               surrounding whitespace removed, "" for anything that is not a string
 *   isEmail(value)            a usable address, see below
 *   isPhone(value)            a phone number in any common international or local layout
 *   check(kind, value, opts)  { ok, value, reason } for 'email' or 'phone'. A blank optional
 *                             value is ok (opts.required is false by default), so an empty
 *                             optional field never blocks a submit
 *
 * Email: one "@", at most 254 characters in all and 64 before the "@". The part before it is
 * made of non-empty pieces joined by single dots (so "..a" and "a..b" are out) and has no
 * spaces or characters like ( ) < > [ ] \ , ; : ". The domain has at least two dot separated labels of
 * letters, digits and hyphens (no hyphen at either end, none longer than 63), and the last one is
 * at least two characters and not all digits. Plus tags ("a+tag@x.org") and non-English
 * letters are fine.
 *
 * Phone: digits with spaces, dashes, dots and brackets, an optional leading "+" or "00" for the
 * country code, and 7 to 15 digits (the E.164 maximum), not counting the "+" or "00". Brackets must
 * be paired and not nested. "(415) 555-0132", "+44 (0)20 7946 0958" and "00 44 20 7946 0958" pass,
 * "12345" and "555-CALL" do not. This is a shape check, it cannot know that a number exists.
 * The appointment form keeps its own stricter Indian mobile rule on top of this
 * (appointment-request.js, normalizePhone).
 *
 * These checks only help honest users. A browser check can be skipped, so a backend has to repeat
 * them on every submission: see docs/FORM_VALIDATION.md.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefValidators = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    email: 254,
    emailLocal: 64,
    domainLabel: 63,
    phoneText: 32, // the longest layout people really type: "+44 (0) 20 7946 0958" is 20
    phoneDigitsMin: 7,
    phoneDigitsMax: 15
  };

  var LOCAL_PART = /^[^\s@.()<>[\]\\,;:"]+(?:\.[^\s@.()<>[\]\\,;:"]+)*$/;
  var DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
  var PHONE_SHAPE = /^[+\d(][\d\s\-().]*$/;
  var PHONE_BRACKETS = /^[^()]*(?:\([^()]*\)[^()]*)*$/;

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isEmail(value) {
    var text = trim(value);
    if (!text || text.length > LIMITS.email) return false;
    var at = text.indexOf('@');
    if (at < 1 || at !== text.lastIndexOf('@')) return false;
    var local = text.slice(0, at);
    if (local.length > LIMITS.emailLocal || !LOCAL_PART.test(local)) return false;
    var labels = text.slice(at + 1).split('.');
    if (labels.length < 2) return false;
    for (var i = 0; i < labels.length; i += 1) {
      if (labels[i].length > LIMITS.domainLabel || !DOMAIN_LABEL.test(labels[i])) return false;
    }
    var tld = labels[labels.length - 1];
    return tld.length >= 2 && /\D/.test(tld);
  }

  // The digits of a number without its international prefix ("+" or "00"), or '' when it is not a phone shape.
  function phoneDigits(value) {
    var text = trim(value);
    if (!text || text.length > LIMITS.phoneText) return '';
    if (!PHONE_SHAPE.test(text) || !PHONE_BRACKETS.test(text)) return '';
    var digits = text.replace(/\D/g, '');
    if (/^00/.test(text)) digits = digits.slice(2);
    return digits;
  }

  function isPhone(value) {
    var digits = phoneDigits(value);
    return digits.length >= LIMITS.phoneDigitsMin && digits.length <= LIMITS.phoneDigitsMax;
  }

  // reason is 'blank' (a required value is empty), 'too-long' or 'invalid'. value is the trimmed text to keep.
  function check(kind, value, options) {
    var required = !!(options && options.required);
    var text = trim(value);
    if (!text) return required ? { ok: false, value: '', reason: 'blank' } : { ok: true, value: '', reason: null };
    if (kind === 'email') {
      if (text.length > LIMITS.email) return { ok: false, value: text, reason: 'too-long' };
      return isEmail(text) ? { ok: true, value: text, reason: null } : { ok: false, value: text, reason: 'invalid' };
    }
    if (kind === 'phone') {
      if (text.length > LIMITS.phoneText) return { ok: false, value: text, reason: 'too-long' };
      return isPhone(text) ? { ok: true, value: text, reason: null } : { ok: false, value: text, reason: 'invalid' };
    }
    throw new Error('ReliefValidators.check: unknown kind ' + kind);
  }

  return { LIMITS: LIMITS, trim: trim, isEmail: isEmail, isPhone: isPhone, phoneDigits: phoneDigits, check: check };
}));
