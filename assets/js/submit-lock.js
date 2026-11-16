/**
 * Relief Healthcare Platform - Submit lock
 *
 * One in-flight submission per form, and one idempotency key per attempt.
 *
 *  - While a submission is pending, another submit (a double click, Enter pressed twice, a
 *    second event handler) is ignored instead of sending a second request.
 *  - The lock is always released when the work finishes, including when it rejects, so a
 *    failure can never leave the form stuck.
 *  - The idempotency key belongs to the content being sent. If a send fails and the person
 *    presses "Try again" with the same content, the same key is used again, so a server that
 *    honours it can tell the repeat from a second submission. Edited content gets a new key.
 *    The key is dropped once the send succeeded.
 *
 * Used by the health event form and the facility correction form. See docs/FORM_PROTECTION.md.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefSubmitLock = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var keyCounter = 0;

  function newKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    keyCounter += 1;
    return 'sl-' + Date.now().toString(36) + '-' + keyCounter + '-' + Math.floor(Math.random() * 0xffffffff).toString(16);
  }

  /** A stable text for "the same content": field names sorted, so key order does not matter. */
  function fingerprintOf(fields) {
    var source = fields || {};
    return JSON.stringify(Object.keys(source).sort().map(function (name) { return [name, source[name]]; }));
  }

  /**
   * options:
   *   onChange(pending)  called with true when a submission starts and false when it ends
   *   newKey()           key generator (tests pass a counter)
   */
  function createSubmitLock(options) {
    var opts = options || {};
    var makeKey = typeof opts.newKey === 'function' ? opts.newKey : newKey;
    var pending = false;
    var remembered = null; // { fingerprint, key } of the last attempt that may be retried

    function notify(value) {
      if (typeof opts.onChange === 'function') opts.onChange(value);
    }

    function keyFor(fingerprint) {
      if (!remembered || remembered.fingerprint !== fingerprint) {
        remembered = { fingerprint: fingerprint, key: makeKey() };
      }
      return remembered.key;
    }

    /**
     * Runs task({ idempotencyKey }) unless a submission is already pending. Never rejects.
     * Resolves with one of:
     *   { status: 'busy' }                          ignored, the pending submission is still running
     *   { status: 'done', value, idempotencyKey }   the task resolved with `value`
     *   { status: 'error', error, idempotencyKey }  the task threw or rejected
     *
     * run options:
     *   fingerprint   what is being sent (fingerprintOf(fields)); same content keeps the same key
     *   keepKey(value) true when a resolved value is still a failure that may be retried (for
     *                 example a result that says "service unavailable"). A rejection always keeps the key.
     */
    async function run(task, runOptions) {
      if (pending) return { status: 'busy' };
      var ro = runOptions || {};
      var idempotencyKey = keyFor(ro.fingerprint === undefined ? '' : String(ro.fingerprint));
      pending = true;
      notify(true);
      try {
        var value = await task({ idempotencyKey: idempotencyKey });
        if (!(typeof ro.keepKey === 'function' && ro.keepKey(value))) remembered = null;
        return { status: 'done', value: value, idempotencyKey: idempotencyKey };
      } catch (error) {
        return { status: 'error', error: error, idempotencyKey: idempotencyKey };
      } finally {
        pending = false;
        notify(false);
      }
    }

    return {
      run: run,
      isPending: function () { return pending; }
    };
  }

  /** The page side of a pending submission: the button is off and the form says it is busy. */
  function setBusy(form, button, busy) {
    if (form) {
      if (busy) form.setAttribute('aria-busy', 'true'); else form.removeAttribute('aria-busy');
    }
    if (button) button.disabled = !!busy;
  }

  return {
    createSubmitLock: createSubmitLock,
    fingerprintOf: fingerprintOf,
    newKey: newKey,
    setBusy: setBusy
  };
});
