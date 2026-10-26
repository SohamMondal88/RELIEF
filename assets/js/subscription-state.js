/**
 * Relief - subscription state, verified by the server only.
 *
 * The browser is not a trusted place to decide who has paid. Anything it can
 * read (localStorage, cookies it can set, URL parameters, a "success" page) can
 * be edited by the person using it. So this module follows one rule:
 *
 *   The ONLY way to get a subscription state is a response from
 *   ReliefAPI.verifySubscription(). If that call fails, times out or sends
 *   something malformed, the state is "unknown" and no paid feature is granted.
 *
 * Nothing here reads localStorage, sessionStorage, cookies or location. A result
 * is only accepted as verified if it was created by normalize() in this file
 * (tracked in a private WeakSet), so a hand-built object, or one revived from
 * JSON, never counts. This protects the UI from honest mistakes and casual
 * tampering. Real enforcement still has to happen on the server for every paid
 * action: see docs/SUBSCRIPTION_SERVER_CONTRACT.md.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefSubscription = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  var STATES = ['none', 'pending', 'active', 'past_due', 'cancelled', 'unknown'];
  var SERVER_STATES = ['none', 'pending', 'active', 'past_due', 'cancelled'];
  var PAYMENT_RESULTS = ['succeeded', 'failed', 'refunded'];

  var PLANS = {
    basic: 'Basic Care',
    plus: 'Plus Care',
    family: 'Family Premium'
  };

  // Feature ids the server may grant, with the wording shown to the user.
  // An id the server sends that is not listed here is dropped, never shown.
  var FEATURES = {
    doctor_chats: 'Doctor chats',
    symptom_history: 'Symptom checker history',
    medicine_reminders: 'Medicine reminders',
    priority_booking: 'Priority appointment booking',
    pharmacy_discount: 'Pharmacy discounts',
    emergency_callback: 'Emergency callback support',
    family_cover: 'Cover for up to 5 members',
    nurse_helpline: '24/7 nurse helpline',
    care_coordinator: 'Dedicated care coordinator'
  };

  var DEFAULT_TIMEOUT_MS = 10000;

  // Results made by normalize() and nothing else.
  var trusted = typeof WeakSet === 'function' ? new WeakSet() : null;

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function parseDate(value) {
    if (typeof value !== 'string' || value.length < 10) return null;
    var time = Date.parse(value);
    return isFinite(time) ? time : null;
  }

  function seal(result, verified) {
    result.features = Object.freeze(result.features.slice());
    Object.freeze(result);
    if (verified && trusted) trusted.add(result);
    return result;
  }

  // The "could not verify" result. Never grants anything.
  function unknown(reason) {
    return seal({
      state: 'unknown',
      verified: false,
      reason: reason || 'unreachable',
      plan: null,
      billingPeriod: null,
      features: [],
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      lastPaymentResult: null,
      verifiedAt: null
    }, false);
  }

  /**
   * Turns a server response body into a state. Anything that is not exactly what
   * the contract describes becomes "unknown" (fail safe, grant nothing).
   */
  function normalize(body) {
    if (!isObject(body) || body.schemaVersion !== SCHEMA_VERSION) return unknown('invalid-response');
    if (SERVER_STATES.indexOf(body.status) === -1) return unknown('invalid-response');

    var serverTime = parseDate(body.serverTime);
    if (serverTime === null) return unknown('invalid-response');

    var plan = null;
    if (body.plan !== null && body.plan !== undefined) {
      if (typeof body.plan !== 'string' || !Object.prototype.hasOwnProperty.call(PLANS, body.plan)) {
        return unknown('invalid-response');
      }
      plan = body.plan;
    }
    var billingPeriod = body.billingPeriod === 'monthly' || body.billingPeriod === 'yearly' ? body.billingPeriod : null;
    var lastPaymentResult = PAYMENT_RESULTS.indexOf(body.lastPaymentResult) !== -1 ? body.lastPaymentResult : null;

    var periodEnd = null;
    if (body.currentPeriodEnd !== null && body.currentPeriodEnd !== undefined) {
      periodEnd = parseDate(body.currentPeriodEnd);
      if (periodEnd === null) return unknown('invalid-response');
    }

    var features = [];
    if (body.status === 'active') {
      // Access needs a known plan and a period that has not ended by the SERVER's clock.
      if (!plan || periodEnd === null || periodEnd <= serverTime) return unknown('invalid-response');
      if (!Array.isArray(body.features)) return unknown('invalid-response');
      body.features.forEach(function (id) {
        if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(FEATURES, id) && features.indexOf(id) === -1) {
          features.push(id);
        }
      });
    }

    return seal({
      state: body.status,
      verified: true,
      reason: null,
      plan: plan,
      billingPeriod: billingPeriod,
      features: features,
      currentPeriodEnd: periodEnd === null ? null : new Date(periodEnd).toISOString(),
      cancelAtPeriodEnd: body.cancelAtPeriodEnd === true,
      lastPaymentResult: lastPaymentResult,
      verifiedAt: new Date(serverTime).toISOString()
    }, true);
  }

  // True only for a result that normalize() made from a server response.
  function isVerified(result) {
    return !!(trusted && result && typeof result === 'object' && trusted.has(result));
  }

  // The features a result unlocks. Empty unless the state is verified AND active.
  function entitlements(result) {
    if (!isVerified(result) || result.state !== 'active') return [];
    return result.features.slice();
  }

  function hasFeature(result, featureId) {
    return entitlements(result).indexOf(featureId) !== -1;
  }

  function featureLabel(featureId) {
    return Object.prototype.hasOwnProperty.call(FEATURES, featureId) ? FEATURES[featureId] : null;
  }

  function planLabel(planId) {
    return Object.prototype.hasOwnProperty.call(PLANS, planId) ? PLANS[planId] : null;
  }

  function formatDate(iso) {
    var time = parseDate(iso);
    if (time === null) return '';
    return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  /**
   * Asks the server (through ReliefAPI) and returns a state. Never rejects and
   * never guesses: any failure is "unknown". Takes `api` so it can be tested.
   * options: { timeoutMs }
   */
  function verify(api, options) {
    var opts = options || {};
    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    var source = api === undefined ? (typeof ReliefAPI !== 'undefined' ? ReliefAPI : null) : api;

    if (!source || typeof source.verifySubscription !== 'function') {
      return Promise.resolve(unknown('no-service'));
    }

    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish(unknown('timeout')); }, timeoutMs);
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(result);
      }
      var call;
      try {
        call = Promise.resolve(source.verifySubscription());
      } catch (error) {
        finish(unknown('unreachable'));
        return;
      }
      call.then(function (body) {
        finish(normalize(body));
      }, function (error) {
        finish(unknown(error && error.code === 'unauthenticated' ? 'unauthenticated' : 'unreachable'));
      });
    });
  }

  /**
   * What to tell the user for a result. { title, message, tone, retry }
   * tone: 'ok' | 'info' | 'warn' | 'error'. retry: true when "Check again" makes sense.
   */
  function describe(result) {
    // Display text is only ever built from a verified result; anything else reads as "unknown".
    var r = isVerified(result) || (result && result.state === 'unknown') ? result : unknown('invalid-response');
    var plan = planLabel(r.plan);
    var until = formatDate(r.currentPeriodEnd);

    switch (r.state) {
      case 'active':
        return {
          title: (plan || 'Your') + ' plan is active',
          message: r.cancelAtPeriodEnd
            ? 'You keep your plan benefits until ' + until + '. It has been cancelled and will not renew.'
            : 'Your plan is paid up and renews on ' + until + '.',
          tone: 'ok',
          retry: false
        };
      case 'pending':
        return {
          title: 'Payment is being confirmed',
          message: 'We have not confirmed your payment yet. Plan benefits stay off until we do. This can take a few minutes.',
          tone: 'info',
          retry: true
        };
      case 'past_due':
        return {
          title: 'Payment needed',
          message: 'We could not collect your last payment, so plan benefits are paused. Contact support to fix your payment method; you can try again safely.',
          tone: 'warn',
          retry: true
        };
      case 'cancelled':
        return {
          title: 'Subscription cancelled',
          message: r.lastPaymentResult === 'refunded'
            ? 'Your last payment was refunded and the plan is cancelled. Plan benefits are off. You can subscribe again at any time.'
            : 'Your plan is cancelled and plan benefits are off. You can subscribe again at any time.',
          tone: 'info',
          retry: false
        };
      case 'none':
        return {
          title: 'No active plan',
          message: r.lastPaymentResult === 'failed'
            ? 'Your payment did not go through, so no plan was started and you were not charged for one. You can try again.'
            : 'You are not subscribed. Pick a plan below when you are ready.',
          tone: 'info',
          retry: false
        };
      default:
        if (r.reason === 'unauthenticated') {
          return {
            title: 'Sign in to see your plan',
            message: 'We could not verify your subscription because you are not signed in. Plan benefits stay off until we can.',
            tone: 'warn',
            retry: true
          };
        }
        return {
          title: 'Could not verify your subscription',
          message: (r.reason === 'invalid-response'
            ? 'The server sent an answer we could not use to confirm your plan.'
            : 'We could not reach the server to check your plan right now.') +
            ' Plan benefits stay off until we can verify it. Nothing was charged or changed.',
          tone: 'error',
          retry: true
        };
    }
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATES: STATES.slice(),
    PLANS: Object.assign({}, PLANS),
    FEATURES: Object.assign({}, FEATURES),
    normalize: normalize,
    unknown: unknown,
    verify: verify,
    isVerified: isVerified,
    entitlements: entitlements,
    hasFeature: hasFeature,
    featureLabel: featureLabel,
    planLabel: planLabel,
    describe: describe
  };
}));
