/**
 * Automated Test Suite for Relief Emergency SOS Flow (Issue #14)
 * 
 * Executed via Node.js built-in test runner:
 * node --test tests/emergency-sos.test.js
 * 
 * Tests cover:
 * A. Confirmation & Cancellation tests
 * B. Request Delivery & Honest States tests
 * C. Safe Geolocation handling & Fallback tests
 * D. Accessibility & Semantic markup tests
 * E. Weak connectivity & Offline/Timeout tests
 * F. Regional Guidance & Emergency Disclaimer tests
 */

const test = require('node:test');
const assert = require('node:assert');
const EmergencySOS = require('../assets/js/emergency-sos.js');

// Minimal mock DOM environment for controller testing in Node
function createMockDOM() {
  const listeners = {};
  const elements = {};

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.attributes = {};
      this.classList = new Set();
      this.children = [];
      this._innerHTML = '';
      this._textContent = '';
      this.listeners = {};
      this.style = {};
      this.disabled = false;
      this.value = '';
    }

    get innerHTML() {
      return this._innerHTML || '';
    }

    set innerHTML(val) {
      this._innerHTML = val;
      if (typeof val === 'string') {
        const idMatches = val.matchAll(/id="([^"]+)"/g);
        for (const match of idMatches) {
          const id = match[1];
          if (!elements[id]) {
            const el = new MockElement(id);
            elements[id] = el;
            this.children.push(el);
          }
        }
      }
    }

    get textContent() {
      return this._textContent || this.innerHTML.replace(/<[^>]*>/g, '');
    }

    set textContent(val) {
      this._textContent = val;
    }

    setAttribute(key, val) {
      this.attributes[key] = String(val);
    }

    getAttribute(key) {
      return this.attributes[key] || null;
    }

    hasAttribute(key) {
      return key in this.attributes;
    }

    removeAttribute(key) {
      delete this.attributes[key];
    }

    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(cb => cb !== fn);
    }

    dispatchEvent(event) {
      const cbs = this.listeners[event.type] || [];
      for (const cb of cbs) cb(event);
    }

    click() {
      this.dispatchEvent({ type: 'click', preventDefault: () => {} });
    }

    focus() {
      MockDocument.activeElement = this;
    }

    appendChild(child) {
      this.children.push(child);
      if (child.id) elements[child.id] = child;
      return child;
    }

    querySelectorAll(selector) {
      const results = [];
      const traverse = (el) => {
        if (selector.includes('button') && el.tagName === 'BUTTON') results.push(el);
        if (selector.includes('[href]') && el.attributes['href']) results.push(el);
        for (const c of el.children) traverse(c);
      };
      traverse(this);
      return results;
    }

    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    }
  }

  const MockDocument = {
    activeElement: null,
    body: new MockElement('body', 'body'),
    createElement(tagName) {
      return new MockElement(null, tagName);
    },
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(cb => cb !== fn);
    },
    _reset() {
      for (const k in elements) delete elements[k];
      for (const k in listeners) delete listeners[k];
      MockDocument.body = new MockElement('body', 'body');
      elements['body'] = MockDocument.body;
      MockDocument.activeElement = null;
    }
  };

  return { MockDocument, MockElement, elements };
}

// =========================================================================
// SECTION A: CONFIRMATION & CANCELLATION TESTS
// =========================================================================
test('A.1: Initializing SOS does not send a request', () => {
  let requestSent = false;
  const mockFetch = async () => {
    requestSent = true;
    return { ok: true, json: async () => ({ delivered: true }) };
  };

  const { MockDocument, MockElement } = createMockDOM();
  global.document = MockDocument;

  const trigger = new MockElement('relief-emergency-sos-trigger', 'button');
  MockDocument.body.appendChild(trigger);

  const controller = new EmergencySOS.EmergencySOSController({
    triggerId: 'relief-emergency-sos-trigger',
    endpoint: 'https://example.com/api/sos',
    fetchFn: mockFetch
  });

  assert.strictEqual(controller.state, EmergencySOS.SOS_STATES.IDLE);
  assert.strictEqual(requestSent, false, 'No request should be sent on initialization');
});

test('A.2: Activating SOS opens confirmation interface and does NOT send request', () => {
  let requestSent = false;
  const mockFetch = async () => {
    requestSent = true;
    return { ok: true, json: async () => ({ delivered: true }) };
  };

  const { MockDocument, MockElement, elements } = createMockDOM();
  global.document = MockDocument;

  const trigger = new MockElement('relief-emergency-sos-trigger', 'button');
  MockDocument.body.appendChild(trigger);

  const controller = new EmergencySOS.EmergencySOSController({
    triggerId: 'relief-emergency-sos-trigger',
    endpoint: 'https://example.com/api/sos',
    fetchFn: mockFetch
  });

  controller.openConfirmationDialog();

  assert.strictEqual(controller.state, EmergencySOS.SOS_STATES.AWAITING_CONFIRMATION);
  assert.strictEqual(requestSent, false, 'No request should be sent when confirmation window opens');
  assert.ok(elements['relief-sos-dialog-container'], 'Dialog container should exist in DOM');
  assert.ok(elements['relief-sos-confirm-btn'], 'Confirm button should exist');
  assert.ok(elements['relief-sos-cancel-btn'], 'Cancel button should exist');
});

test('A.3: Cancelling SOS dialog closes window and does NOT send request', () => {
  let requestSent = false;
  const mockFetch = async () => {
    requestSent = true;
    return { ok: true, json: async () => ({ delivered: true }) };
  };

  const { MockDocument, MockElement } = createMockDOM();
  global.document = MockDocument;

  const trigger = new MockElement('relief-emergency-sos-trigger', 'button');
  MockDocument.body.appendChild(trigger);

  const controller = new EmergencySOS.EmergencySOSController({
    triggerId: 'relief-emergency-sos-trigger',
    endpoint: 'https://example.com/api/sos',
    fetchFn: mockFetch
  });

  controller.openConfirmationDialog();
  controller.closeDialog(true);

  assert.strictEqual(controller.state, EmergencySOS.SOS_STATES.IDLE);
  assert.strictEqual(requestSent, false, 'No request should be sent when user cancels');
});

test('A.4: Escape key cancels dialog without sending request', () => {
  let requestSent = false;
  const mockFetch = async () => {
    requestSent = true;
    return { ok: true, json: async () => ({ delivered: true }) };
  };

  const { MockDocument, MockElement } = createMockDOM();
  global.document = MockDocument;

  const trigger = new MockElement('relief-emergency-sos-trigger', 'button');
  MockDocument.body.appendChild(trigger);

  const controller = new EmergencySOS.EmergencySOSController({
    triggerId: 'relief-emergency-sos-trigger',
    endpoint: 'https://example.com/api/sos',
    fetchFn: mockFetch
  });

  controller.openConfirmationDialog();
  // Simulate Escape key
  controller.onKeyDown({ key: 'Escape', keyCode: 27, preventDefault: () => {} });

  assert.strictEqual(controller.state, EmergencySOS.SOS_STATES.IDLE);
  assert.strictEqual(requestSent, false, 'Escape key must cancel without sending request');
});

test('A.5: Confirming action initiates request and prevents duplicate submissions', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    // Simulate delay
    await new Promise(r => setTimeout(r, 10));
    return {
      ok: true,
      json: async () => ({ delivered: true, requestId: 'req_123' })
    };
  };

  const { MockDocument, MockElement } = createMockDOM();
  global.document = MockDocument;

  const trigger = new MockElement('relief-emergency-sos-trigger', 'button');
  MockDocument.body.appendChild(trigger);

  const controller = new EmergencySOS.EmergencySOSController({
    triggerId: 'relief-emergency-sos-trigger',
    endpoint: 'https://example.com/api/sos',
    fetchFn: mockFetch
  });

  controller.openConfirmationDialog();

  // Execute confirmation twice simultaneously to test idempotency / double-click protection
  const promise1 = controller.executeConfirmedSOS();
  const promise2 = controller.executeConfirmedSOS();

  await Promise.all([promise1, promise2]);

  assert.strictEqual(callCount, 1, 'Repeated confirmation activation must not produce duplicate network requests');
});

// =========================================================================
// SECTION B: DELIVERY-STATE & HONEST RESULT TESTS
// =========================================================================
test('B.1: Successfully accepted backend response produces SENT state', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      delivered: true,
      requestId: 'SOS_ABC_999'
    })
  });

  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH' },
    { endpoint: 'https://example.com/api/sos', fetchFn: mockFetch }
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.state, EmergencySOS.SOS_STATES.SENT);
  assert.strictEqual(result.delivered, true);
  assert.strictEqual(result.requestId, 'SOS_ABC_999');
  assert.ok(result.message.includes('successfully accepted'));
});

test('B.2: HTTP error status produces FAILED state with honest error message', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable'
  });

  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH' },
    { endpoint: 'https://example.com/api/sos', fetchFn: mockFetch }
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.state, EmergencySOS.SOS_STATES.FAILED);
  assert.strictEqual(result.delivered, false);
  assert.strictEqual(result.status, 503);
  assert.ok(result.message.includes('503'));
  assert.ok(result.guidance.includes('Do not assume assistance has been dispatched'));
});

test('B.3: Malformed JSON response produces FAILED state without false success', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => {
      throw new Error('Unexpected token < in JSON at position 0');
    }
  });

  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH' },
    { endpoint: 'https://example.com/api/sos', fetchFn: mockFetch }
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.state, EmergencySOS.SOS_STATES.FAILED);
  assert.strictEqual(result.delivered, false);
  assert.ok(result.message.includes('malformed response'));
});

test('B.4: 200 OK without delivery guarantee does NOT produce false success', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ status: 'received', message: 'Payload logged' }) // delivered is omitted or false
  });

  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH' },
    { endpoint: 'https://example.com/api/sos', fetchFn: mockFetch }
  );

  assert.strictEqual(result.success, false, 'Must not claim success without delivery guarantee');
  assert.strictEqual(result.delivered, false);
  assert.strictEqual(result.state, EmergencySOS.SOS_STATES.FAILED);
});

test('B.5: Missing backend endpoint reports truth and does not fake dispatch', async () => {
  // When no backend endpoint is configured (which matches static Relief deployment)
  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH', location: { lat: 24.4, lng: 86.4 } },
    { endpoint: null }
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.delivered, false);
  assert.strictEqual(result.noBackendConfigured, true);
  assert.ok(result.message.includes('No live emergency dispatch backend is configured'));
  assert.ok(result.guidance.includes('NOT been contacted online'));
});

// =========================================================================
// SECTION C: SAFE LOCATION HANDLING & FALLBACK TESTS
// =========================================================================
test('C.1: Location is included when available and valid', async () => {
  const mockGeolocation = {
    getCurrentPosition(success) {
      success({
        coords: {
          latitude: 24.4172,
          longitude: 86.4731,
          accuracy: 15
        },
        timestamp: Date.now()
      });
    }
  };

  const loc = await EmergencySOS.fetchLocation({ geolocation: mockGeolocation });
  assert.strictEqual(loc.lat, 24.4172);
  assert.strictEqual(loc.lng, 86.4731);
  assert.strictEqual(loc.accuracy, 15);
});

test('C.2: Permission denial does not crash and provides clear error info', async () => {
  const mockGeolocation = {
    getCurrentPosition(success, error) {
      error({ code: 1, message: 'User denied Geolocation' });
    }
  };

  await assert.rejects(
    async () => {
      await EmergencySOS.fetchLocation({ geolocation: mockGeolocation });
    },
    (err) => {
      assert.strictEqual(err.isPermissionDenied, true);
      assert.ok(err.message.includes('denied'));
      return true;
    }
  );
});

test('C.3: Geolocation timeout is handled safely', async () => {
  const mockGeolocation = {
    getCurrentPosition(success, error) {
      error({ code: 3, message: 'Timeout expired' });
    }
  };

  await assert.rejects(
    async () => {
      await EmergencySOS.fetchLocation({ geolocation: mockGeolocation });
    },
    (err) => {
      assert.strictEqual(err.isTimeout, true);
      assert.ok(err.message.includes('timed out'));
      return true;
    }
  );
});

test('C.4: Unsupported geolocation does not throw unhandled exception', async () => {
  await assert.rejects(
    async () => {
      await EmergencySOS.fetchLocation({ geolocation: null });
    },
    (err) => {
      assert.strictEqual(err.code, 'UNSUPPORTED');
      assert.strictEqual(err.isUnavailable, true);
      return true;
    }
  );
});

test('C.5: SMS fallback payload generates accurate format with location', () => {
  const sms = EmergencySOS.buildSMSFallback({
    recipientNumber: '112',
    userName: 'Aarav',
    location: { lat: 24.417234, lng: 86.473123 }
  });

  assert.strictEqual(sms.recipient, '112');
  assert.ok(sms.bodyText.includes('Aarav requires urgent medical assistance'));
  assert.ok(sms.bodyText.includes('Lat:24.417234, Lng:86.473123'));
  assert.ok(sms.smsHref.startsWith('sms:112?body='));
});

test('C.6: SMS fallback handles missing location safely without fake coordinates', () => {
  const sms = EmergencySOS.buildSMSFallback({
    recipientNumber: '112',
    location: null
  });

  assert.ok(sms.bodyText.includes('Location: Unavailable (permission denied or GPS off)'));
  assert.ok(!sms.bodyText.includes('Lat:'));
});

// =========================================================================
// SECTION D: WEAK CONNECTIVITY & OFFLINE TESTS
// =========================================================================
test('D.1: Offline condition is detected and returns OFFLINE state', async () => {
  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH' },
    { endpoint: 'https://example.com/api/sos', isOnline: false }
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.state, EmergencySOS.SOS_STATES.OFFLINE);
  assert.strictEqual(result.delivered, false);
  assert.ok(result.message.includes('offline'));
  assert.ok(result.guidance.includes('SMS fallback'));
});

test('D.2: Network timeout returns TIMED_OUT state and communicates uncertainty', async () => {
  const mockFetch = async () => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  };

  const result = await EmergencySOS.dispatchSOS(
    { urgency: 'HIGH' },
    { endpoint: 'https://example.com/api/sos', fetchFn: mockFetch }
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.state, EmergencySOS.SOS_STATES.TIMED_OUT);
  assert.strictEqual(result.delivered, false);
  assert.ok(result.message.includes('timed out'));
  assert.ok(result.guidance.includes('Unable to confirm whether the request reached responders'));
});

// =========================================================================
// SECTION E: REGIONAL GUIDANCE & DISCLAIMER TESTS
// =========================================================================
test('E.1: India regional configuration contains verified 112 ERSS and 108', () => {
  const indiaConfig = EmergencySOS.REGIONAL_EMERGENCY_DATA.IN;
  assert.ok(indiaConfig);
  assert.strictEqual(indiaConfig.primaryNumber, '112');
  assert.ok(indiaConfig.primarySource.includes('Emergency Response Support System (ERSS)'));
  assert.ok(indiaConfig.primarySource.includes('112.gov.in'));

  const numbers = indiaConfig.services.map(s => s.number);
  assert.ok(numbers.includes('112'), 'Must include 112 national emergency helpline');
  assert.ok(numbers.includes('108'), 'Must include 108 ambulance service');
  assert.ok(numbers.includes('102'), 'Must include 102 maternity/child ambulance');
});

test('E.2: Emergency disclaimer is explicit and warns that Relief is not a replacement', () => {
  const disclaimer = EmergencySOS.EMERGENCY_DISCLAIMER;
  assert.ok(disclaimer.includes('DISCLAIMER'));
  assert.ok(disclaimer.includes('does NOT replace official local emergency dispatch services'));
  assert.ok(disclaimer.includes('112 in India'));
  assert.ok(disclaimer.includes('network connectivity and server availability'));
});

test('E.3: Actionable tel links match international standards', () => {
  for (const regionKey in EmergencySOS.REGIONAL_EMERGENCY_DATA) {
    const region = EmergencySOS.REGIONAL_EMERGENCY_DATA[regionKey];
    assert.match(region.primaryNumber, /^[0-9]+$/, `Primary number for ${regionKey} must be numeric digits`);
    for (const svc of region.services) {
      assert.match(svc.number, /^[0-9]+$/, `Service number ${svc.number} must be numeric digits`);
      assert.ok(svc.source, `Service ${svc.name} must have documented official source`);
    }
  }
});
