/**
 * Relief - demo mode and local demo accounts
 *
 * The real sign-in service is ReliefAPI. A browser-only fallback exists so the
 * site can be tried without a backend, but it is NOT real authentication:
 * anything stored in the browser can be read or changed by whoever uses it.
 * This module makes that fallback explicit:
 *   - it only runs in demo mode (localhost, 127.0.0.1, a file:// preview, or an
 *     explicit window.RELIEF_DEMO_MODE = true / <meta name="relief-demo-mode" content="true">)
 *   - on any other host, if the service is unavailable, sign-in fails with a message
 *   - wrong credentials reported by the service never fall back to the local store
 *   - demo passwords are never stored in plain text, only a salted PBKDF2 hash
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefAuth = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEMO_USERS_KEY = 'relief_demo_users';
  // Older builds saved { email, password } here in plain text.
  var LEGACY_USERS_KEY = 'relief_users';
  var PBKDF2_ITERATIONS = 210000;
  var LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

  var UNAVAILABLE_MESSAGE = 'Sign-in service is unavailable. Please try again later.';
  var DEMO_NOTICE = 'Demo mode: accounts are kept only in this browser and are not secure. Do not use a real password or real health information.';

  // Errors from the service that mean "the answer is no", as opposed to "no answer".
  var CREDENTIAL_CODES = [
    'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-login-credentials',
    'auth/invalid-email', 'auth/user-disabled', 'auth/email-already-in-use', 'auth/weak-password',
    'auth/too-many-requests'
  ];
  var CREDENTIAL_MESSAGES = ['Invalid email or password format', 'User not found'];

  function AuthError(message, kind) {
    var err = new Error(message);
    err.name = 'AuthError';
    err.kind = kind;
    return err;
  }

  /**
   * env: { hostname, protocol, flag, metaContent }
   * Demo mode is on for local hosts, a file:// preview, or an explicit flag.
   */
  function isDemoMode(env) {
    var e = env || {};
    if (e.flag === true) return true;
    if (String(e.metaContent || '').toLowerCase() === 'true') return true;
    if (e.protocol === 'file:') return true;
    return LOCAL_HOSTS.indexOf(String(e.hostname || '').toLowerCase()) !== -1;
  }

  function readEnv() {
    var env = {};
    if (typeof location !== 'undefined') {
      env.hostname = location.hostname;
      env.protocol = location.protocol;
    }
    if (typeof window !== 'undefined') env.flag = window.RELIEF_DEMO_MODE;
    if (typeof document !== 'undefined' && document.querySelector) {
      var meta = document.querySelector('meta[name="relief-demo-mode"]');
      env.metaContent = meta ? meta.getAttribute('content') : '';
    }
    return env;
  }

  // 'credentials' when the service answered no, 'unavailable' for anything else
  // (network, configuration, unexpected errors).
  function classifyError(error) {
    if (!error) return 'unavailable';
    if (typeof error.code === 'string' && CREDENTIAL_CODES.indexOf(error.code) !== -1) return 'credentials';
    if (typeof error.message === 'string' && CREDENTIAL_MESSAGES.indexOf(error.message) !== -1) return 'credentials';
    return 'unavailable';
  }

  function credentialMessage(error, action) {
    var code = error && error.code;
    if (code === 'auth/email-already-in-use') return 'Email already in use. Please login instead.';
    if (code === 'auth/weak-password') return 'Password is too weak. Choose a longer one.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a while and try again.';
    return action === 'signup' ? 'Could not create the account. Check your details and try again.' : 'Invalid email or password.';
  }

  // ---- demo account store -------------------------------------------------

  function readUsers(storage) {
    try {
      var parsed = JSON.parse(storage.getItem(DEMO_USERS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeUsers(storage, users) {
    try {
      storage.setItem(DEMO_USERS_KEY, JSON.stringify(users));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Removes the old plain-text password store. Safe to call on any host.
  function purgeLegacyUsers(storage) {
    try {
      if (storage.getItem(LEGACY_USERS_KEY) !== null) storage.removeItem(LEGACY_USERS_KEY);
    } catch (e) {
      // Storage blocked: nothing to purge.
    }
  }

  function toHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return (b < 16 ? '0' : '') + b.toString(16);
    }).join('');
  }

  function fromHex(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  async function hashPassword(password, saltHex, cryptoImpl, iterations) {
    var subtle = cryptoImpl && cryptoImpl.subtle;
    if (!subtle) {
      throw AuthError('Demo accounts need a secure browser context (HTTPS or localhost).', 'demo-unsupported');
    }
    var key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iterations || PBKDF2_ITERATIONS },
      key,
      256
    );
    return toHex(bits);
  }

  function newSalt(cryptoImpl) {
    if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') {
      throw AuthError('Demo accounts need a secure browser context (HTTPS or localhost).', 'demo-unsupported');
    }
    return toHex(cryptoImpl.getRandomValues(new Uint8Array(16)));
  }

  function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function publicUser(record) {
    return { uid: record.id, email: record.email, name: record.name, demo: true };
  }

  async function demoLogin(email, password, d) {
    var users = readUsers(d.storage);
    var record = users.find(function (u) { return u && u.email === email; });
    if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') {
      throw AuthError('Invalid email or password.', 'credentials');
    }
    var hash = await hashPassword(password, record.salt, d.crypto, record.iterations);
    if (!safeEqual(hash, record.hash)) throw AuthError('Invalid email or password.', 'credentials');
    return publicUser(record);
  }

  async function demoSignup(name, email, password, d) {
    var users = readUsers(d.storage);
    if (users.some(function (u) { return u && u.email === email; })) {
      throw AuthError('Email already in use. Please login instead.', 'credentials');
    }
    var salt = newSalt(d.crypto);
    var record = {
      id: 'demo_' + Date.now().toString(36) + '_' + salt.slice(0, 8),
      name: name,
      email: email,
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: await hashPassword(password, salt, d.crypto),
      createdAt: new Date().toISOString()
    };
    users.push(record);
    if (!writeUsers(d.storage, users)) {
      throw AuthError('Browser storage is unavailable, so the demo account could not be saved.', 'storage');
    }
    return publicUser(record);
  }

  // ---- public flow --------------------------------------------------------

  function resolve(deps) {
    var d = deps || {};
    return {
      api: 'api' in d ? d.api : (typeof ReliefAPI !== 'undefined' ? ReliefAPI : null),
      storage: d.storage || (typeof localStorage !== 'undefined' ? localStorage : null),
      env: d.env || readEnv(),
      crypto: d.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null)
    };
  }

  /**
   * Signs in through the service. The local demo store is used only in demo mode
   * and only when the service could not be reached, never after a wrong answer.
   */
  async function login(email, password, deps) {
    var d = resolve(deps);
    var demo = isDemoMode(d.env);
    if (d.storage) purgeLegacyUsers(d.storage);

    if (d.api && typeof d.api.login === 'function') {
      try {
        return await d.api.login(email, password);
      } catch (error) {
        if (classifyError(error) === 'credentials') throw AuthError(credentialMessage(error, 'login'), 'credentials');
        if (!demo) throw AuthError(UNAVAILABLE_MESSAGE, 'unavailable');
      }
    } else if (!demo) {
      throw AuthError(UNAVAILABLE_MESSAGE, 'unavailable');
    }
    return demoLogin(email, password, d);
  }

  async function signup(name, email, password, deps) {
    var d = resolve(deps);
    var demo = isDemoMode(d.env);
    if (d.storage) purgeLegacyUsers(d.storage);

    if (d.api && typeof d.api.signup === 'function') {
      try {
        return await d.api.signup({ name: name, email: email, password: password, joined: new Date().toISOString() });
      } catch (error) {
        if (classifyError(error) === 'credentials') throw AuthError(credentialMessage(error, 'signup'), 'credentials');
        if (!demo) throw AuthError(UNAVAILABLE_MESSAGE, 'unavailable');
      }
    } else if (!demo) {
      throw AuthError(UNAVAILABLE_MESSAGE, 'unavailable');
    }
    return demoSignup(name, email, password, d);
  }

  // Shows the demo notice element when the page is in demo mode.
  function showDemoNotice(element, deps) {
    if (!element) return false;
    var demo = isDemoMode(resolve(deps).env);
    element.textContent = demo ? DEMO_NOTICE : '';
    element.hidden = !demo;
    return demo;
  }

  return {
    DEMO_USERS_KEY: DEMO_USERS_KEY,
    LEGACY_USERS_KEY: LEGACY_USERS_KEY,
    UNAVAILABLE_MESSAGE: UNAVAILABLE_MESSAGE,
    DEMO_NOTICE: DEMO_NOTICE,
    isDemoMode: isDemoMode,
    classifyError: classifyError,
    purgeLegacyUsers: purgeLegacyUsers,
    login: login,
    signup: signup,
    showDemoNotice: showDemoNotice
  };
}));
