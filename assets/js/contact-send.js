/**
 * Relief - contact form delivery
 *
 * The contact form may only say that a message was sent when the RELIEF backend
 * confirmed it. This site has no backend of its own: ReliefAPI.submitContactMessage()
 * talks to one only when it is configured (see assets/js/api.js). With no backend,
 * or with any answer that is not a clear confirmation, send() rejects, so the page
 * can say "not sent" and keep the visitor's text instead of faking a success.
 *
 * Contract: docs/FORM_PROTECTION.md (Contact form delivery).
 * Pure functions plus send(), which takes its API as an argument, so it runs in node:test.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefContactSend = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = { name: 100, email: 254, subject: 40, message: 2000 };
  // Longer text would make a mailto: link too long for some mail apps.
  var MAILTO_BODY_MAX = 1500;

  var MESSAGES = {
    unavailable: 'Your message was not sent. This site is not connected to a message service right now.',
    rateLimited: 'Your message was not sent because too many messages came from this browser. Please wait a while and try again.',
    rejected: 'Your message was not sent: the message service did not accept it. Please check it and try again.',
    notConfirmed: 'Your message may not have been sent: the message service did not confirm that it received it.'
  };

  function clean(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var FIELD_ORDER = ['name', 'email', 'message', 'consent'];

  /**
   * Checks the form fields and returns { fieldKey: message } for each problem, in page order.
   * An empty object means the form can be sent. The text is only measured (trimmed), never changed.
   */
  function validate(fields) {
    var f = fields || {};
    var errors = {};
    var name = String(f.name == null ? '' : f.name).trim();
    var email = String(f.email == null ? '' : f.email).trim();
    var message = String(f.message == null ? '' : f.message).trim();

    if (name === '') errors.name = 'Please enter your name';
    else if (name.length < 2) errors.name = 'Name must be at least 2 characters';
    else if (name.length > LIMITS.name) errors.name = 'Name must be ' + LIMITS.name + ' characters or fewer';

    if (email === '') errors.email = 'Please enter your email';
    else if (email.length > LIMITS.email) errors.email = 'Email address must be ' + LIMITS.email + ' characters or fewer';
    else if (!EMAIL_PATTERN.test(email)) errors.email = 'Please enter a valid email address';

    if (message === '') errors.message = 'Please enter your message';
    else if (message.length < 10) errors.message = 'Message must be at least 10 characters';
    else if (message.length > LIMITS.message) errors.message = 'Message must be ' + LIMITS.message + ' characters or fewer (now ' + message.length + ')';

    if (!f.consent) errors.consent = 'You must agree to the privacy policy';

    return errors;
  }

  /** The exact fields that go to the backend. Nothing else (no honeypot, no browser data). */
  function buildPayload(fields) {
    var f = fields || {};
    return {
      name: clean(f.name, LIMITS.name),
      email: clean(f.email, LIMITS.email),
      subject: clean(f.subject, LIMITS.subject),
      message: clean(f.message, LIMITS.message),
      consent: f.consent === true
    };
  }

  function failure(kind, message) {
    var error = new Error(message);
    error.name = 'ReliefContactError';
    error.kind = kind;
    return error;
  }

  /**
   * Sends the message through the RELIEF backend.
   * Resolves only when the backend answered { "status": "received" }.
   * Rejects with an Error whose .kind is one of
   *   unavailable   no backend configured, unreachable, timed out, 5xx
   *   rate-limited  the backend said 429
   *   rejected      the backend refused the content (other 4xx)
   *   not-confirmed the backend answered 2xx but did not say "received"
   * and whose .message is safe to show to the visitor.
   */
  async function send(api, fields) {
    if (!api || typeof api.submitContactMessage !== 'function') {
      throw failure('unavailable', MESSAGES.unavailable);
    }
    var answer;
    try {
      answer = await api.submitContactMessage(buildPayload(fields));
    } catch (error) {
      var code = error && error.code;
      if (code === 'rate-limited') throw failure('rate-limited', MESSAGES.rateLimited);
      if (code === 'rejected') throw failure('rejected', MESSAGES.rejected);
      throw failure('unavailable', MESSAGES.unavailable);
    }
    if (!answer || typeof answer !== 'object' || answer.status !== 'received') {
      throw failure('not-confirmed', MESSAGES.notConfirmed);
    }
    return { status: 'received' };
  }

  /** A mailto: link that opens the visitor's own mail app with their text filled in. Nothing is sent by the page. */
  function mailtoHref(address, fields) {
    var payload = buildPayload(fields);
    var lines = [];
    if (payload.message) lines.push(payload.message.slice(0, MAILTO_BODY_MAX));
    if (payload.name) lines.push('', payload.name);
    var subject = payload.subject ? 'RELIEF contact: ' + payload.subject : 'RELIEF contact message';
    return 'mailto:' + address + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
  }

  return {
    LIMITS: LIMITS,
    FIELD_ORDER: FIELD_ORDER,
    MESSAGES: MESSAGES,
    validate: validate,
    buildPayload: buildPayload,
    send: send,
    mailtoHref: mailtoHref
  };
}));
