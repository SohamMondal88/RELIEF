/**
 * Relief Healthcare Platform - Guided First-Visit Onboarding Flow
 *
 * Implements GitHub Issue #53:
 * - Introduces core implemented features: facility search, emergency resources,
 *   medicine reminders, and cautious health support.
 * - Skippable and dismissible at any point.
 * - Emergency information and actions remain accessible throughout.
 * - Never requests location or account details during onboarding.
 * - Revisit capability via the "Tour" navigation control or programmatic API.
 * - State and preferences persist strictly via localStorage key: 'relief_onboarding_status'.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ReliefOnboarding = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'relief_onboarding_status';

  // Verified, actually implemented features only
  var STEPS = [
    {
      id: 'emergency',
      stepNumber: 1,
      icon: 'fa-ambulance',
      badgeKey: 'onboarding.step1.badge',
      badgeDefault: 'Urgent Care',
      titleKey: 'onboarding.step1.title',
      titleDefault: 'Emergency Resources & SOS',
      descKey: 'onboarding.step1.desc',
      descDefault: 'Immediate 24/7 access to national emergency helplines (112, 108) and ambulance requests. Pre-hospital first-aid instructions are accessible offline without needing an account or login.',
      highlightKey: 'onboarding.step1.highlight',
      highlightDefault: 'Urgent care is always open and never blocked by setup.',
      actionKey: 'onboarding.step1.action',
      actionDefault: 'View Emergency Services',
      actionHref: 'pages/ambulances.html'
    },
    {
      id: 'facilities',
      stepNumber: 2,
      icon: 'fa-hospital',
      badgeKey: 'onboarding.step2.badge',
      badgeDefault: 'Directory',
      titleKey: 'onboarding.step2.title',
      titleDefault: 'Healthcare Facility Search',
      descKey: 'onboarding.step2.desc',
      descDefault: 'Search and filter local hospitals, clinics, pharmacies, and verified doctors with contact numbers and operating hours. Save essential facilities to your browser for quick offline reference.',
      highlightKey: 'onboarding.step2.highlight',
      highlightDefault: 'Search anytime without an account; location permission is completely optional.',
      actionKey: 'onboarding.step2.action',
      actionDefault: 'Find Hospitals',
      actionHref: 'pages/hospitals.html'
    },
    {
      id: 'reminders',
      stepNumber: 3,
      icon: 'fa-pills',
      badgeKey: 'onboarding.step3.badge',
      badgeDefault: 'Health Tracking',
      titleKey: 'onboarding.step3.title',
      titleDefault: 'Medication Reminders',
      descKey: 'onboarding.step3.desc',
      descDefault: 'Manage your daily prescriptions and schedule dosage times right from your personal dashboard. Your schedule is kept privately in your browser storage with timely dose alerts.',
      highlightKey: 'onboarding.step3.highlight',
      highlightDefault: 'Stored locally on your device with no registration needed.',
      actionKey: 'onboarding.step3.action',
      actionDefault: 'Open Dashboard',
      actionHref: 'pages/dashboard.html'
    },
    {
      id: 'support',
      stepNumber: 4,
      icon: 'fa-stethoscope',
      badgeKey: 'onboarding.step4.badge',
      badgeDefault: 'Assistance',
      titleKey: 'onboarding.step4.title',
      titleDefault: 'Cautious Health Support',
      descKey: 'onboarding.step4.desc',
      descDefault: 'Use our interactive symptom checker for cautious, non-diagnostic guidance and red-flag screening. RELIEF supports English and Bengali, with core guidance available offline.',
      highlightKey: 'onboarding.step4.highlight',
      highlightDefault: 'You can revisit this tour anytime using the Tour button in the navigation.',
      actionKey: 'onboarding.step4.action',
      actionDefault: 'Check Symptoms',
      actionHref: 'pages/symptoms.html'
    }
  ];

  var inMemoryState = null;

  function getStorage(customStorage) {
    if (customStorage) return customStorage;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {
      // SecurityError or restricted environment
    }
    return null;
  }

  function getOnboardingState(customStorage) {
    var store = getStorage(customStorage);
    try {
      if (store) {
        var raw = store.getItem(STORAGE_KEY);
        if (!raw) return null;
        try {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch (jsonErr) {
          if (raw === 'completed' || raw === 'skipped') {
            return { status: raw, timestamp: null };
          }
        }
      }
    } catch (err) {
      // Storage access exception
    }
    return inMemoryState;
  }

  function setOnboardingStatus(customStorage, status, metadata) {
    var state = {
      status: status, // 'completed' | 'skipped'
      timestamp: Date.now()
    };
    if (metadata && typeof metadata === 'object') {
      Object.assign(state, metadata);
    }

    var store = getStorage(customStorage);
    try {
      if (store) {
        store.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (err) {
      // QuotaExceededError or private browsing
    }
    inMemoryState = state;
    return state;
  }

  function shouldShowOnboarding(customStorage) {
    var state = getOnboardingState(customStorage);
    if (!state) return true;
    return state.status !== 'completed' && state.status !== 'skipped';
  }

  function resetOnboardingStatus(customStorage) {
    var store = getStorage(customStorage);
    try {
      if (store) {
        store.removeItem(STORAGE_KEY);
      }
    } catch (err) {}
    inMemoryState = null;
  }

  function resolveHref(href) {
    if (typeof window !== 'undefined' && window.location && window.location.pathname.includes('/pages/')) {
      return href.replace(/^pages\//, '');
    }
    return href;
  }

  // Active UI Controller
  var currentStep = 0;
  var isOpen = false;
  var dialogEl = null;
  var triggerEl = null;
  var activeStorage = null;
  var keydownHandler = null;

  function createDialogDOM(doc) {
    var d = doc || document;
    var container = d.createElement('div');
    container.id = 'relief-onboarding-container';
    container.className = 'relief-onboarding-container';

    container.innerHTML =
      '<div class="relief-onboarding-backdrop" data-action="backdrop-dismiss" aria-hidden="true"></div>' +
      '<div class="relief-onboarding-wrapper" role="presentation">' +
        '<div class="relief-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="relief-onboarding-title" aria-describedby="relief-onboarding-desc" tabindex="-1">' +
          '<div class="relief-onboarding-emergency-banner" role="alert">' +
            '<div class="relief-onboarding-emergency-content">' +
              '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
              '<span data-i18n="onboarding.emergency_banner">In a medical emergency? Call 112 / 108 or jump straight to Emergency SOS.</span>' +
            '</div>' +
            '<a href="' + resolveHref('pages/ambulances.html') + '" class="relief-onboarding-emergency-btn" data-i18n="onboarding.emergency_btn">Emergency SOS</a>' +
          '</div>' +
          '<div class="relief-onboarding-header">' +
            '<div class="relief-onboarding-meta">' +
              '<span class="relief-onboarding-badge" id="relief-onboarding-badge"></span>' +
              '<span class="relief-onboarding-counter" id="relief-onboarding-counter" aria-live="polite"></span>' +
            '</div>' +
            '<button type="button" class="relief-onboarding-close" aria-label="Close guide" data-action="close" data-i18n-attr="aria-label:onboarding.close">&times;</button>' +
          '</div>' +
          '<div class="relief-onboarding-body">' +
            '<div class="relief-onboarding-icon-wrap" id="relief-onboarding-icon-wrap" aria-hidden="true">' +
              '<i class="fas fa-ambulance" id="relief-onboarding-icon"></i>' +
            '</div>' +
            '<h2 class="relief-onboarding-title" id="relief-onboarding-title"></h2>' +
            '<p class="relief-onboarding-desc" id="relief-onboarding-desc"></p>' +
            '<div class="relief-onboarding-highlight">' +
              '<i class="fas fa-check-circle" aria-hidden="true"></i>' +
              '<span id="relief-onboarding-highlight-text"></span>' +
            '</div>' +
            '<a href="#" class="relief-onboarding-feature-link" id="relief-onboarding-feature-link">' +
              '<span id="relief-onboarding-feature-text"></span> &rarr;' +
            '</a>' +
          '</div>' +
          '<div class="relief-onboarding-dots" id="relief-onboarding-dots" role="tablist" aria-label="Tour step indicators"></div>' +
          '<div class="relief-onboarding-actions">' +
            '<button type="button" class="relief-onboarding-btn relief-onboarding-btn-skip" data-action="skip" data-i18n="onboarding.skip">Skip Tour</button>' +
            '<div class="relief-onboarding-actions-right">' +
              '<button type="button" class="relief-onboarding-btn relief-onboarding-btn-prev" data-action="prev" data-i18n="onboarding.back" style="display: none;">Back</button>' +
              '<button type="button" class="relief-onboarding-btn relief-onboarding-btn-next" data-action="next" data-i18n="onboarding.next">Next &rarr;</button>' +
              '<button type="button" class="relief-onboarding-btn relief-onboarding-btn-finish" data-action="finish" data-i18n="onboarding.finish" style="display: none;">Get Started</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    return container;
  }

  function renderStep(stepIndex, doc) {
    var d = doc || document;
    var step = STEPS[stepIndex];
    if (!step) return;

    var badge = d.getElementById('relief-onboarding-badge');
    var counter = d.getElementById('relief-onboarding-counter');
    var icon = d.getElementById('relief-onboarding-icon');
    var title = d.getElementById('relief-onboarding-title');
    var desc = d.getElementById('relief-onboarding-desc');
    var highlight = d.getElementById('relief-onboarding-highlight-text');
    var featureLink = d.getElementById('relief-onboarding-feature-link');
    var featureText = d.getElementById('relief-onboarding-feature-text');
    var dotsContainer = d.getElementById('relief-onboarding-dots');
    var prevBtn = d.querySelector ? d.querySelector('.relief-onboarding-btn-prev') : null;
    var nextBtn = d.querySelector ? d.querySelector('.relief-onboarding-btn-next') : null;
    var finishBtn = d.querySelector ? d.querySelector('.relief-onboarding-btn-finish') : null;

    if (badge) {
      badge.setAttribute('data-i18n', step.badgeKey);
      badge.textContent = step.badgeDefault;
    }

    if (counter) {
      counter.textContent = 'Step ' + (stepIndex + 1) + ' of ' + STEPS.length;
    }

    if (icon) {
      icon.className = 'fas ' + step.icon;
    }

    if (title) {
      title.setAttribute('data-i18n', step.titleKey);
      title.textContent = step.titleDefault;
    }

    if (desc) {
      desc.setAttribute('data-i18n', step.descKey);
      desc.textContent = step.descDefault;
    }

    if (highlight) {
      highlight.setAttribute('data-i18n', step.highlightKey);
      highlight.textContent = step.highlightDefault;
    }

    if (featureLink && featureText) {
      featureLink.href = resolveHref(step.actionHref);
      featureText.setAttribute('data-i18n', step.actionKey);
      featureText.textContent = step.actionDefault;
    }

    // Render interactive dots
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      STEPS.forEach(function (_, i) {
        var dot = d.createElement('button');
        dot.type = 'button';
        dot.className = 'relief-onboarding-dot' + (i === stepIndex ? ' active' : '');
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-selected', i === stepIndex ? 'true' : 'false');
        dot.setAttribute('aria-label', 'Go to step ' + (i + 1));
        dot.addEventListener('click', function () {
          goToStep(i, d);
        });
        dotsContainer.appendChild(dot);
      });
    }

    // Update navigation buttons
    if (prevBtn) {
      prevBtn.style.display = stepIndex === 0 ? 'none' : 'inline-flex';
    }

    if (nextBtn && finishBtn) {
      var isLast = stepIndex === STEPS.length - 1;
      nextBtn.style.display = isLast ? 'none' : 'inline-flex';
      finishBtn.style.display = isLast ? 'inline-flex' : 'none';
    }

    // Reapply i18n translation if available
    if (typeof window !== 'undefined' && window.ReliefI18n && dialogEl) {
      window.ReliefI18n.apply(dialogEl);
    }
  }

  function open(stepIndex, doc, trigger, storage) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.body) return false;

    if (trigger) triggerEl = trigger;
    if (storage) activeStorage = storage;

    if (!dialogEl || !d.getElementById('relief-onboarding-container')) {
      dialogEl = createDialogDOM(d);
      d.body.appendChild(dialogEl);

      // Event delegation inside dialog
      dialogEl.addEventListener('click', function (e) {
        var target = e.target;
        var actionEl = target.closest ? target.closest('[data-action]') : null;
        if (!actionEl) return;

        var action = actionEl.getAttribute('data-action');
        if (action === 'close' || action === 'backdrop-dismiss') {
          close('skip', d);
        } else if (action === 'skip') {
          close('skip', d);
        } else if (action === 'next') {
          next(d);
        } else if (action === 'prev') {
          prev(d);
        } else if (action === 'finish') {
          close('finish', d);
        }
      });
    }

    currentStep = typeof stepIndex === 'number' ? stepIndex : 0;
    if (currentStep < 0) currentStep = 0;
    if (currentStep >= STEPS.length) currentStep = STEPS.length - 1;

    renderStep(currentStep, d);

    if (d.body.classList) {
      d.body.classList.add('relief-onboarding-open');
    }

    isOpen = true;

    // Focus the dialog card or primary action for accessibility
    var dialogCard = d.querySelector ? d.querySelector('.relief-onboarding-dialog') : null;
    if (dialogCard && typeof dialogCard.focus === 'function') {
      dialogCard.focus();
    }

    // Keyboard controls
    if (!keydownHandler) {
      keydownHandler = function (e) {
        if (!isOpen) return;
        if (e.key === 'Escape') {
          close('skip', d);
        } else if (e.key === 'ArrowRight') {
          next(d);
        } else if (e.key === 'ArrowLeft') {
          prev(d);
        }
      };
      d.addEventListener('keydown', keydownHandler);
    }

    return true;
  }

  function close(reason, doc, storage) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!isOpen) return false;

    var targetStorage = storage || activeStorage;
    if (reason === 'finish') {
      setOnboardingStatus(targetStorage, 'completed', { completedAtStep: currentStep + 1 });
    } else {
      setOnboardingStatus(targetStorage, 'skipped', { dismissedAtStep: currentStep + 1 });
    }

    if (dialogEl && dialogEl.parentNode) {
      dialogEl.parentNode.removeChild(dialogEl);
      dialogEl = null;
    }

    if (d && d.body && d.body.classList) {
      d.body.classList.remove('relief-onboarding-open');
    }

    if (keydownHandler && d) {
      d.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }

    isOpen = false;

    // Restore focus to trigger if available
    if (triggerEl && typeof triggerEl.focus === 'function') {
      triggerEl.focus();
      triggerEl = null;
    }

    return true;
  }

  function next(doc) {
    if (currentStep < STEPS.length - 1) {
      currentStep++;
      renderStep(currentStep, doc);
    } else {
      close('finish', doc);
    }
  }

  function prev(doc) {
    if (currentStep > 0) {
      currentStep--;
      renderStep(currentStep, doc);
    }
  }

  function goToStep(index, doc) {
    if (index >= 0 && index < STEPS.length) {
      currentStep = index;
      renderStep(currentStep, doc);
    }
  }

  function attachRevisitListeners(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return;

    var triggers = d.querySelectorAll
      ? d.querySelectorAll('#btn-revisit-tour, #footer-revisit-tour, [data-action="open-tour"]')
      : [];

    triggers.forEach(function (btn) {
      if (!btn.dataset || btn.dataset.tourBound === 'true') return;
      btn.dataset.tourBound = 'true';
      btn.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        open(0, d, btn);
      });
    });
  }

  function init(options) {
    var opts = options || {};
    if (opts.storage) activeStorage = opts.storage;
    var d = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!d) return false;

    attachRevisitListeners(d);

    // Auto-show for first-time visitors if allowed
    if (opts.autoStart !== false && shouldShowOnboarding(opts.storage)) {
      var splash = d.querySelector ? d.querySelector('.splash-screen') : null;
      if (splash) {
        // Wait until splash screen is done fading
        setTimeout(function () {
          if (shouldShowOnboarding(opts.storage) && !isOpen) {
            open(0, d);
          }
        }, 3300);
      } else {
        open(0, d);
      }
    }

    return true;
  }

  // Automatic DOM initialization on page load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        init();
      });
    } else {
      init();
    }
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    STEPS: STEPS,
    getStorage: getStorage,
    getOnboardingState: getOnboardingState,
    setOnboardingStatus: setOnboardingStatus,
    shouldShowOnboarding: shouldShowOnboarding,
    resetOnboardingStatus: resetOnboardingStatus,
    init: init,
    open: open,
    start: function (stepIndex, doc, trigger) { return open(stepIndex, doc, trigger); },
    close: close,
    next: next,
    prev: prev,
    goToStep: goToStep,
    getCurrentStep: function () { return currentStep; },
    isTourOpen: function () { return isOpen; }
  };
});
