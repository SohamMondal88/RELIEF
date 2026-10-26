/**
 * Automated Test Suite for RELIEF Guided First-Visit Onboarding Flow (GitHub Issue #53)
 *
 * Verifies:
 * 1. First-visit detection and eligibility
 * 2. Skip tour behaviour and persistence
 * 3. Step progression, completion behaviour, and persistence
 * 4. Repeat-visit suppression (no auto-prompt when completed/skipped)
 * 5. Revisit capability via navigation button or programmatic API
 * 6. Emergency information accessibility without onboarding completion
 * 7. Storage persistence strictly through documented mechanism ('relief_onboarding_status')
 * 8. Error resilience with disabled/corrupted storage
 * 9. Honest feature scope: no feature described unless implemented
 * 10. Zero unsolicited geolocation or account credential requests
 * 11. Internationalization (i18n) key synchronization across en.json and bn.json
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Onboarding = require('../assets/js/onboarding.js');

const root = path.join(__dirname, '..');
const enLocale = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'locales', 'en.json'), 'utf8'));
const bnLocale = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'locales', 'bn.json'), 'utf8'));

function createMemoryStorage(initialData) {
  const store = new Map(Object.entries(initialData || {}));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); }
  };
}

function createFaultyStorage() {
  return {
    getItem: () => { throw new Error('Storage disabled / SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('Storage disabled'); }
  };
}

// Lightweight mock DOM for controller testing in Node
function createMockDOM() {
  const listeners = {};
  const elements = {};
  const bodyClassList = new Set();
  let focusedElement = null;

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.attributes = {};
      this.dataset = {};
      this.classList = new Set();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this._textContent = '';
      this._innerHTML = '';
      this.listeners = {};
    }

    setAttribute(attr, val) {
      this.attributes[attr] = String(val);
    }

    getAttribute(attr) {
      return this.attributes[attr] || null;
    }

    removeAttribute(attr) {
      delete this.attributes[attr];
    }

    focus() {
      focusedElement = this;
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(val) {
      this._textContent = String(val);
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(val) {
      this._innerHTML = String(val);
      // Auto-register elements with ids from template
      const idMatches = val.matchAll(/id="([^"]+)"/g);
      for (const match of idMatches) {
        const id = match[1];
        if (!elements[id]) {
          const el = new MockElement(id);
          el.parentNode = this;
          elements[id] = el;
          this.children.push(el);
        }
      }
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) {
        elements[child.id] = child;
      }
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
        if (child.id && elements[child.id] === child) {
          delete elements[child.id];
        }
      }
      return child;
    }

    addEventListener(event, fn) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(h => h !== fn);
      }
    }

    dispatchEvent(event) {
      const handlers = this.listeners[event.type] || [];
      handlers.forEach(h => h(event));
    }

    closest(selector) {
      let cur = this;
      while (cur) {
        if (selector === '[data-action]' && cur.getAttribute('data-action')) return cur;
        if (selector.startsWith('.') && cur.classList.has(selector.slice(1))) return cur;
        if (selector.startsWith('#') && cur.id === selector.slice(1)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
  }

  const mockBody = new MockElement('body', 'body');
  mockBody.classList = {
    add: (c) => bodyClassList.add(c),
    remove: (c) => bodyClassList.delete(c),
    contains: (c) => bodyClassList.has(c)
  };

  const mockDoc = {
    body: mockBody,
    createElement: (tag) => new MockElement('', tag),
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => {
      if (sel === '.relief-onboarding-dialog') return elements['relief-onboarding-dialog'] || new MockElement('', 'div');
      if (sel === '.relief-onboarding-btn-prev') return elements['relief-onboarding-btn-prev'] || new MockElement('', 'button');
      if (sel === '.relief-onboarding-btn-next') return elements['relief-onboarding-btn-next'] || new MockElement('', 'button');
      if (sel === '.relief-onboarding-btn-finish') return elements['relief-onboarding-btn-finish'] || new MockElement('', 'button');
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('#btn-revisit-tour')) {
        return [elements['btn-revisit-tour'] || new MockElement('btn-revisit-tour', 'button')];
      }
      return [];
    },
    addEventListener: (event, fn) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener: (event, fn) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== fn);
      }
    },
    dispatchEvent: (event) => {
      const handlers = listeners[event.type] || [];
      handlers.forEach(h => h(event));
    }
  };

  return { mockDoc, mockBody, elements, listeners, getFocused: () => focusedElement };
}

describe('GitHub Issue #53: Guided First-Visit Onboarding Flow', () => {

  beforeEach(() => {
    Onboarding.resetOnboardingStatus();
  });

  // =========================================================================
  // 1. First-Visit Detection and State Logic
  // =========================================================================
  describe('State and First-Visit Detection', () => {
    it('detects a first-time visitor when storage is empty', () => {
      const storage = createMemoryStorage();
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), true);
      assert.strictEqual(Onboarding.getOnboardingState(storage), null);
    });

    it('uses the documented storage key "relief_onboarding_status"', () => {
      assert.strictEqual(Onboarding.STORAGE_KEY, 'relief_onboarding_status');
    });

    it('records skipped state with timestamp and step metadata', () => {
      const storage = createMemoryStorage();
      const state = Onboarding.setOnboardingStatus(storage, 'skipped', { dismissedAtStep: 2 });
      assert.strictEqual(state.status, 'skipped');
      assert.strictEqual(state.dismissedAtStep, 2);
      assert.ok(typeof state.timestamp === 'number');

      const raw = storage.getItem(Onboarding.STORAGE_KEY);
      assert.ok(raw);
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.status, 'skipped');
      assert.strictEqual(parsed.dismissedAtStep, 2);
    });

    it('records completed state with timestamp and step metadata', () => {
      const storage = createMemoryStorage();
      const state = Onboarding.setOnboardingStatus(storage, 'completed', { completedAtStep: 4 });
      assert.strictEqual(state.status, 'completed');
      assert.strictEqual(state.completedAtStep, 4);

      const saved = Onboarding.getOnboardingState(storage);
      assert.strictEqual(saved.status, 'completed');
    });

    it('supports string-only legacy format without crashing', () => {
      const storage = createMemoryStorage({ [Onboarding.STORAGE_KEY]: 'completed' });
      const state = Onboarding.getOnboardingState(storage);
      assert.strictEqual(state.status, 'completed');
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), false);
    });

    it('can reset onboarding status cleanly', () => {
      const storage = createMemoryStorage();
      Onboarding.setOnboardingStatus(storage, 'completed');
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), false);

      Onboarding.resetOnboardingStatus(storage);
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), true);
      assert.strictEqual(storage.getItem(Onboarding.STORAGE_KEY), null);
    });
  });

  // =========================================================================
  // 2. Skip, Completion, and Repeat-Visit Behavior
  // =========================================================================
  describe('Skip, Completion & Repeat-Visit Suppression', () => {
    it('suppresses auto-show after the tour is skipped', () => {
      const storage = createMemoryStorage();
      Onboarding.setOnboardingStatus(storage, 'skipped');
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), false);
    });

    it('suppresses auto-show after the tour is completed', () => {
      const storage = createMemoryStorage();
      Onboarding.setOnboardingStatus(storage, 'completed');
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), false);
    });

    it('allows repeating or revisiting the tour explicitly even when previously completed', () => {
      const storage = createMemoryStorage();
      Onboarding.setOnboardingStatus(storage, 'completed');
      assert.strictEqual(Onboarding.shouldShowOnboarding(storage), false);

      const dom = createMockDOM();
      const opened = Onboarding.open(0, dom.mockDoc);
      assert.strictEqual(opened, true, 'Tour must open on explicit request');
      assert.strictEqual(Onboarding.isTourOpen(), true);

      Onboarding.close('skip', dom.mockDoc);
      assert.strictEqual(Onboarding.isTourOpen(), false);
    });

    it('survives corrupted storage data without throwing or breaking the site', () => {
      const storage = createMemoryStorage({ [Onboarding.STORAGE_KEY]: 'corrupted-{{{{not-json' });
      assert.doesNotThrow(() => {
        const shouldShow = Onboarding.shouldShowOnboarding(storage);
        assert.strictEqual(shouldShow, true);
      });
    });

    it('falls back to memory state safely when storage access throws', () => {
      const faultyStorage = createFaultyStorage();
      assert.doesNotThrow(() => {
        const state = Onboarding.setOnboardingStatus(faultyStorage, 'completed');
        assert.strictEqual(state.status, 'completed');
        assert.strictEqual(Onboarding.shouldShowOnboarding(faultyStorage), false);
      });
    });
  });

  // =========================================================================
  // 3. Emergency Accessibility Without Onboarding Completion
  // =========================================================================
  describe('Emergency Resources Accessibility', () => {
    it('always highlights emergency access in step 1', () => {
      const step1 = Onboarding.STEPS[0];
      assert.strictEqual(step1.id, 'emergency');
      assert.ok(step1.titleDefault.includes('Emergency'));
      assert.ok(step1.descDefault.includes('112') || step1.descDefault.includes('emergency'));
      assert.ok(step1.actionHref.includes('ambulances.html'));
    });

    it('includes a permanent emergency SOS banner in the dialog DOM', () => {
      const dom = createMockDOM();
      Onboarding.open(0, dom.mockDoc);
      const container = dom.mockDoc.getElementById('relief-onboarding-container');
      assert.ok(container, 'Container element must exist');
      assert.ok(container.innerHTML.includes('relief-onboarding-emergency-banner'), 'Emergency banner must be present');
      assert.ok(container.innerHTML.includes('Emergency SOS'), 'Direct Emergency SOS action must be present');
      assert.ok(container.innerHTML.includes('112'), 'Helpline number 112 must be visible');
      Onboarding.close('skip', dom.mockDoc);
    });

    it('dismisses immediately on Escape key without requiring completion', () => {
      const dom = createMockDOM();
      Onboarding.open(0, dom.mockDoc);
      assert.strictEqual(Onboarding.isTourOpen(), true);

      // Simulate Escape key press
      dom.mockDoc.dispatchEvent({ type: 'keydown', key: 'Escape' });
      assert.strictEqual(Onboarding.isTourOpen(), false, 'Tour must dismiss on Escape key');
    });

    it('unlocks body scroll when dismissed or closed', () => {
      const dom = createMockDOM();
      Onboarding.open(0, dom.mockDoc);
      assert.strictEqual(dom.mockBody.classList.contains('relief-onboarding-open'), true);

      Onboarding.close('skip', dom.mockDoc);
      assert.strictEqual(dom.mockBody.classList.contains('relief-onboarding-open'), false);
    });
  });

  // =========================================================================
  // 4. Scope and Feature Honesty (Only implemented features described)
  // =========================================================================
  describe('Feature Scope & Truthfulness', () => {
    it('has exactly 4 core steps introducing only real features', () => {
      assert.strictEqual(Onboarding.STEPS.length, 4);
      const stepIds = Onboarding.STEPS.map(s => s.id);
      assert.deepStrictEqual(stepIds, ['emergency', 'facilities', 'reminders', 'support']);
    });

    it('references existing project files for every step action', () => {
      Onboarding.STEPS.forEach(step => {
        const filePath = path.join(root, step.actionHref);
        assert.ok(fs.existsSync(filePath), `Target action file must exist: ${step.actionHref}`);
      });
    });

    it('does NOT describe unverified features (no telemedicine video, drone delivery, or payment)', () => {
      const fullText = JSON.stringify(Onboarding.STEPS).toLowerCase();
      assert.strictEqual(fullText.includes('video call'), false);
      assert.strictEqual(fullText.includes('telemedicine video'), false);
      assert.strictEqual(fullText.includes('drone'), false);
      assert.strictEqual(fullText.includes('credit card'), false);
      assert.strictEqual(fullText.includes('payment gateway'), false);
      assert.strictEqual(fullText.includes('cloud database sync'), false);
    });

    it('explicitly states that no account or login is required to explore', () => {
      const fullText = JSON.stringify(Onboarding.STEPS);
      assert.ok(fullText.includes('without needing an account') || fullText.includes('without an account') || fullText.includes('no registration needed'));
    });
  });

  // =========================================================================
  // 5. Zero Unsolicited Permissions & Privacy
  // =========================================================================
  describe('Privacy & Zero Unsolicited Permissions', () => {
    it('does NOT invoke or reference navigator.geolocation in onboarding script', () => {
      const scriptContent = fs.readFileSync(path.join(root, 'assets', 'js', 'onboarding.js'), 'utf8');
      assert.strictEqual(scriptContent.includes('getCurrentPosition'), false);
      assert.strictEqual(scriptContent.includes('watchPosition'), false);
    });

    it('does NOT include account credential input fields in onboarding dialog', () => {
      const scriptContent = fs.readFileSync(path.join(root, 'assets', 'js', 'onboarding.js'), 'utf8');
      assert.strictEqual(scriptContent.includes('type="password"'), false);
      assert.strictEqual(scriptContent.includes('type="email"'), false);
    });
  });

  // =========================================================================
  // 6. Navigation Controls and Revisit Access
  // =========================================================================
  describe('Step Navigation and Revisit Controls', () => {
    it('advances steps sequentially with next() and prev()', () => {
      const dom = createMockDOM();
      Onboarding.open(0, dom.mockDoc);
      assert.strictEqual(Onboarding.getCurrentStep(), 0);

      Onboarding.next(dom.mockDoc);
      assert.strictEqual(Onboarding.getCurrentStep(), 1);

      Onboarding.next(dom.mockDoc);
      assert.strictEqual(Onboarding.getCurrentStep(), 2);

      Onboarding.prev(dom.mockDoc);
      assert.strictEqual(Onboarding.getCurrentStep(), 1);

      Onboarding.goToStep(3, dom.mockDoc);
      assert.strictEqual(Onboarding.getCurrentStep(), 3);

      Onboarding.close('skip', dom.mockDoc);
    });

    it('completes the tour on next() at the final step', () => {
      const dom = createMockDOM();
      const storage = createMemoryStorage();
      Onboarding.open(3, dom.mockDoc, null, storage);
      assert.strictEqual(Onboarding.getCurrentStep(), 3);

      Onboarding.next(dom.mockDoc);
      assert.strictEqual(Onboarding.isTourOpen(), false);
      const state = Onboarding.getOnboardingState(storage);
      // Completes successfully
      assert.ok(state !== null);
    });

    it('provides accessible Revisit Tour triggers in index.html navbar and footer', () => {
      const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      assert.ok(indexHtml.includes('id="btn-revisit-tour"'), 'Navbar revisit button must exist in index.html');
      assert.ok(indexHtml.includes('id="footer-revisit-tour"'), 'Footer revisit link must exist in index.html');
      assert.ok(indexHtml.includes('assets/js/onboarding.js'), 'onboarding.js script tag must be included in index.html');
      assert.ok(indexHtml.includes('assets/css/onboarding.css'), 'onboarding.css link tag must be included in index.html');
    });
  });

  // =========================================================================
  // 7. Internationalization (i18n) Synchronization
  // =========================================================================
  describe('Internationalization (i18n)', () => {
    it('has all onboarding keys defined in both en.json and bn.json', () => {
      const requiredKeys = [
        'nav.tour',
        'footer.tour',
        'onboarding.emergency_banner',
        'onboarding.emergency_btn',
        'onboarding.close',
        'onboarding.skip',
        'onboarding.back',
        'onboarding.next',
        'onboarding.finish',
        'onboarding.step1.badge',
        'onboarding.step1.title',
        'onboarding.step1.desc',
        'onboarding.step1.highlight',
        'onboarding.step1.action',
        'onboarding.step2.badge',
        'onboarding.step2.title',
        'onboarding.step2.desc',
        'onboarding.step2.highlight',
        'onboarding.step2.action',
        'onboarding.step3.badge',
        'onboarding.step3.title',
        'onboarding.step3.desc',
        'onboarding.step3.highlight',
        'onboarding.step3.action',
        'onboarding.step4.badge',
        'onboarding.step4.title',
        'onboarding.step4.desc',
        'onboarding.step4.highlight',
        'onboarding.step4.action'
      ];

      requiredKeys.forEach(k => {
        assert.ok(k in enLocale, `Missing key in en.json: ${k}`);
        assert.ok(k in bnLocale, `Missing key in bn.json: ${k}`);
        assert.ok(enLocale[k].length > 0, `en.json key is empty: ${k}`);
        assert.ok(bnLocale[k].length > 0, `bn.json key is empty: ${k}`);
      });
    });

    it('Bengali translations for onboarding contain valid Bengali Unicode characters', () => {
      const onboardingBnKeys = Object.keys(bnLocale).filter(k => k.startsWith('onboarding.') || k.includes('tour'));
      assert.ok(onboardingBnKeys.length >= 25);
      onboardingBnKeys.forEach(k => {
        assert.match(bnLocale[k], /[\u0980-\u09FF]/, `Key ${k} has no Bengali text: ${bnLocale[k]}`);
      });
    });
  });
});
