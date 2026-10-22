/**
 * Relief Healthcare Platform - Emergency SOS Flow
 * 
 * Provides a prominent, accessible, one-tap emergency SOS flow with confirmation,
 * cancellation, safe geolocation handling, weak connectivity/offline detection,
 * honest request delivery states, verified regional emergency guidance, and
 * explicit emergency disclaimers.
 *
 * Implements Issue #14: Add one-tap emergency SOS flow with confirmation and fallback.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.EmergencySOS = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // State definitions for explicit request lifecycle
  const SOS_STATES = {
    IDLE: 'IDLE',
    AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
    SENDING: 'SENDING',
    SENT: 'SENT',
    FAILED: 'FAILED',
    OFFLINE: 'OFFLINE',
    TIMED_OUT: 'TIMED_OUT',
    LOCATION_DENIED: 'LOCATION_DENIED',
    LOCATION_ERROR: 'LOCATION_ERROR',
    CANCELLED: 'CANCELLED'
  };

  // Official, verified regional emergency services directory
  // Sources:
  // - India: Emergency Response Support System (ERSS), Ministry of Home Affairs, Government of India (https://112.gov.in)
  //          National Health Mission / Ministry of Health and Family Welfare (https://nhm.gov.in)
  // - EU/GSM: European Commission Universal Emergency Number 112 (https://digital-strategy.ec.europa.eu)
  // - US/CA: National 911 Program / FCC (https://www.911.gov)
  // - UK: UK Home Office / British Telecom Emergency 999/112 (https://www.gov.uk)
  const REGIONAL_EMERGENCY_DATA = {
    IN: {
      code: 'IN',
      name: 'India (Default)',
      primaryNumber: '112',
      primaryLabel: 'National Emergency Helpline (ERSS 112)',
      primarySource: 'Official: Emergency Response Support System (ERSS), Ministry of Home Affairs, Govt. of India (112.gov.in)',
      services: [
        {
          name: 'National Emergency Helpline (Police / Fire / Health / Disaster)',
          number: '112',
          source: 'Govt. of India ERSS (112.gov.in)',
          recommended: true
        },
        {
          name: 'Emergency Medical & Ambulance Services',
          number: '108',
          source: 'MoHFW / State Emergency Medical Services',
          recommended: true
        },
        {
          name: 'Janani Shishu Suraksha Karyakram (Maternal & Child Ambulance)',
          number: '102',
          source: 'National Health Mission, Govt. of India',
          recommended: false
        }
      ]
    },
    EU: {
      code: 'EU',
      name: 'European Union & GSM Universal',
      primaryNumber: '112',
      primaryLabel: 'Single European Emergency Number (112)',
      primarySource: 'Official: European Commission / EENA (digital-strategy.ec.europa.eu)',
      services: [
        {
          name: 'Universal Emergency Services (Police, Ambulance, Fire)',
          number: '112',
          source: 'European Commission Universal 112',
          recommended: true
        }
      ]
    },
    US: {
      code: 'US',
      name: 'United States & Canada',
      primaryNumber: '911',
      primaryLabel: 'National Emergency Number (911)',
      primarySource: 'Official: National 911 Program / Federal Communications Commission (911.gov)',
      services: [
        {
          name: 'Emergency Police, Fire & Medical Dispatch',
          number: '911',
          source: 'National 911 Program (911.gov)',
          recommended: true
        }
      ]
    },
    UK: {
      code: 'UK',
      name: 'United Kingdom',
      primaryNumber: '999',
      primaryLabel: 'UK Emergency Services (999 / 112)',
      primarySource: 'Official: UK Home Office / National Health Service (gov.uk)',
      services: [
        {
          name: 'Emergency Ambulance, Police, Fire, Coastguard',
          number: '999',
          source: 'UK Emergency Services (999)',
          recommended: true
        },
        {
          name: 'Secondary Universal Emergency Number',
          number: '112',
          source: 'UK / EU Emergency 112',
          recommended: false
        }
      ]
    }
  };

  const EMERGENCY_DISCLAIMER =
    'DISCLAIMER: Relief is a healthcare companion web tool and does NOT replace official local emergency dispatch services. In a life-threatening emergency, always dial your local emergency number (such as 112 in India or 911 in the US) directly from a telephone. SOS delivery over the web depends entirely on network connectivity and server availability.';

  /**
   * Generates an SMS fallback body and link for situations where
   * internet access is weak or unavailable.
   */
  function buildSMSFallback(options) {
    const opts = options || {};
    const recipient = opts.recipientNumber || '112';
    const userName = opts.userName || 'Relief User';
    const timestamp = new Date().toISOString();
    let bodyText = `EMERGENCY SOS - ${userName} requires urgent medical assistance. Time: ${timestamp}.`;

    if (opts.location && typeof opts.location.lat === 'number' && typeof opts.location.lng === 'number') {
      const lat = opts.location.lat.toFixed(6);
      const lng = opts.location.lng.toFixed(6);
      bodyText += ` Location: https://maps.google.com/?q=${lat},${lng} (Lat:${lat}, Lng:${lng})`;
    } else if (opts.locationNote) {
      bodyText += ` Location Note: ${opts.locationNote}`;
    } else {
      bodyText += ' Location: Unavailable (permission denied or GPS off).';
    }

    const encodedBody = encodeURIComponent(bodyText);
    const smsHref = `sms:${recipient}?body=${encodedBody}`;

    return {
      recipient,
      bodyText,
      smsHref
    };
  }

  /**
   * Safely retrieves user geolocation with an explicit timeout.
   * Does NOT request location until triggered.
   * Never fabricates fake coordinates.
   */
  function fetchLocation(options) {
    const opts = options || {};
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 8000;
    const geolocationAPI = opts.geolocation || (typeof navigator !== 'undefined' ? navigator.geolocation : null);

    return new Promise((resolve, reject) => {
      if (!geolocationAPI || typeof geolocationAPI.getCurrentPosition !== 'function') {
        return reject({
          code: 'UNSUPPORTED',
          message: 'Geolocation is not supported by your browser or device.',
          isPermissionDenied: false,
          isTimeout: false,
          isUnavailable: true
        });
      }

      let hasFinished = false;
      const timer = setTimeout(() => {
        if (!hasFinished) {
          hasFinished = true;
          reject({
            code: 'TIMEOUT',
            message: 'Location request timed out. You may proceed without location.',
            isPermissionDenied: false,
            isTimeout: true,
            isUnavailable: true
          });
        }
      }, timeoutMs);

      geolocationAPI.getCurrentPosition(
        (position) => {
          if (hasFinished) return;
          hasFinished = true;
          clearTimeout(timer);

          if (!position || !position.coords) {
            return reject({
              code: 'INVALID_POSITION',
              message: 'Invalid location data received.',
              isPermissionDenied: false,
              isTimeout: false,
              isUnavailable: true
            });
          }

          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy || null,
            timestamp: position.timestamp || Date.now()
          });
        },
        (error) => {
          if (hasFinished) return;
          hasFinished = true;
          clearTimeout(timer);

          const isPermissionDenied = error && error.code === 1; // PERMISSION_DENIED
          const isPositionUnavailable = error && error.code === 2; // POSITION_UNAVAILABLE
          const isTimeout = error && error.code === 3; // TIMEOUT

          let message = 'Unable to determine location.';
          if (isPermissionDenied) {
            message = 'Location access was denied. You can proceed without location.';
          } else if (isTimeout) {
            message = 'Location request timed out. You can proceed without location.';
          } else if (isPositionUnavailable) {
            message = 'Location information is currently unavailable.';
          }

          reject({
            code: error && error.code ? error.code : 'ERROR',
            message,
            isPermissionDenied,
            isTimeout,
            isUnavailable: isPositionUnavailable || !isPermissionDenied
          });
        },
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 10000
        }
      );
    });
  }

  /**
   * Dispatches the SOS request to the backend or handles the absence of one truthfully.
   * 
   * Strict Safety & Delivery Rules:
   * 1. Never report success when no real delivery took place.
   * 2. If no backend endpoint is configured, clearly report NO_BACKEND_CONFIGURED
   *    and direct the user to phone/SMS fallback.
   * 3. Handle offline conditions, slow network, timeouts (10s), and server errors.
   */
  async function dispatchSOS(payload, options) {
    const opts = options || {};
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
    const isOnline = typeof opts.isOnline === 'boolean'
      ? opts.isOnline
      : (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
          ? navigator.onLine
          : true);

    // 1. Check offline status
    if (!isOnline) {
      return {
        success: false,
        state: SOS_STATES.OFFLINE,
        delivered: false,
        message: 'Your device appears to be offline. Network requests cannot be sent right now.',
        guidance: 'Please call emergency services directly or use the SMS fallback link below.'
      };
    }

    // 2. Identify backend endpoint
    const endpoint = opts.endpoint || (typeof window !== 'undefined' && window.RELIEF_SOS_ENDPOINT ? window.RELIEF_SOS_ENDPOINT : null);

    // 3. Truthful reporting when no backend endpoint is configured
    if (!endpoint) {
      return {
        success: false,
        state: SOS_STATES.FAILED,
        delivered: false,
        noBackendConfigured: true,
        message: 'No live emergency dispatch backend is configured for this Relief deployment.',
        guidance: 'Local emergency services have NOT been contacted online. Please dial your local emergency number (112 in India, 911 in the US) directly.',
        recordedPayload: {
          timestamp: new Date().toISOString(),
          location: payload ? payload.location : null,
          details: payload ? payload.details : null
        }
      };
    }

    // 4. Send request to configured backend with timeout
    const fetchFn = opts.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) {
      return {
        success: false,
        state: SOS_STATES.FAILED,
        delivered: false,
        message: 'Networking capability (fetch) is unavailable.',
        guidance: 'Please call emergency services directly.'
      };
    }

    let controller;
    let timerId;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timerId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }

    try {
      const idempotencyKey = opts.idempotencyKey || `sos_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          ...(opts.headers || {})
        },
        body: JSON.stringify({
          ...payload,
          idempotencyKey,
          sentAt: new Date().toISOString()
        }),
        signal: controller ? controller.signal : undefined
      });

      if (timerId) clearTimeout(timerId);

      // Handle non-OK HTTP responses
      if (!response.ok) {
        return {
          success: false,
          state: SOS_STATES.FAILED,
          delivered: false,
          status: response.status,
          message: `The server responded with an error (HTTP ${response.status}). SOS request could not be confirmed.`,
          guidance: 'Do not assume assistance has been dispatched. Please call emergency services directly.'
        };
      }

      // Parse JSON response
      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        return {
          success: false,
          state: SOS_STATES.FAILED,
          delivered: false,
          message: 'Received an invalid or malformed response from the emergency server.',
          guidance: 'Unable to confirm delivery. Please contact emergency services directly by phone.'
        };
      }

      // Check whether backend explicitly confirmed dispatch/acceptance
      if (data && (data.delivered === true || data.status === 'accepted' || data.status === 'dispatched')) {
        return {
          success: true,
          state: SOS_STATES.SENT,
          delivered: true,
          requestId: data.requestId || data.id || null,
          message: 'SOS request was successfully accepted by the emergency server.',
          guidance: 'Help is being coordinated. Keep your phone line open and accessible.'
        };
      } else {
        // Backend returned HTTP 200, but did not confirm emergency dispatch
        return {
          success: false,
          state: SOS_STATES.FAILED,
          delivered: false,
          message: data && data.message ? data.message : 'The server received the request but did not confirm dispatch.',
          guidance: 'Please call emergency services directly to ensure assistance.'
        };
      }
    } catch (err) {
      if (timerId) clearTimeout(timerId);

      if (err && (err.name === 'AbortError' || err.message?.includes('aborted'))) {
        return {
          success: false,
          state: SOS_STATES.TIMED_OUT,
          delivered: false,
          message: 'The SOS request timed out before the server acknowledged receipt.',
          guidance: 'Unable to confirm whether the request reached responders. Please call emergency services directly.'
        };
      }

      // General network or connection failure
      return {
        success: false,
        state: SOS_STATES.FAILED,
        delivered: false,
        message: 'A network connection failure occurred while attempting to send the SOS.',
        guidance: 'Please call your local emergency service immediately by phone.'
      };
    }
  }

  /**
   * Manages the DOM, Accessibility, Focus, and User Interactions for the SOS flow.
   */
  class EmergencySOSController {
    constructor(options) {
      this.options = options || {};
      this.state = SOS_STATES.IDLE;
      this.currentRegion = this.options.defaultRegion || 'IN';
      this.activeLocation = null;
      this.locationStatus = 'pending';
      this.isSubmitting = false;
      this.lastResult = null;
      this.previouslyFocusedElement = null;

      this.initTrigger();
    }

    initTrigger() {
      if (typeof document === 'undefined') return;

      const triggerBtn = document.getElementById(this.options.triggerId || 'relief-emergency-sos-trigger');
      if (triggerBtn) {
        this.triggerBtn = triggerBtn;
        this.triggerBtn.setAttribute('aria-haspopup', 'dialog');
        this.triggerBtn.setAttribute('aria-expanded', 'false');
        this.triggerBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openConfirmationDialog();
        });
      }

      // Global delegation ensures buttons work regardless of DOM timing
      if (!EmergencySOSController._delegatedListenerBound && typeof document.addEventListener === 'function') {
        EmergencySOSController._delegatedListenerBound = true;
        document.addEventListener('click', (e) => {
          if (!e.target || typeof e.target.closest !== 'function') return;
          const targetTrigger = e.target.closest('#relief-emergency-sos-trigger, .relief-sos-trigger-btn, .relief-sos-fab');
          if (targetTrigger) {
            e.preventDefault();
            const inst = (typeof window !== 'undefined' && window._reliefSOSInstance) || this;
            if (inst && typeof inst.openConfirmationDialog === 'function') {
              inst.openConfirmationDialog();
            }
          }
        });
      }
    }

    /**
     * Opens the confirmation dialog and traps focus.
     */
    openConfirmationDialog() {
      if (this.state === SOS_STATES.SENDING) return;

      this.state = SOS_STATES.AWAITING_CONFIRMATION;
      this.lastResult = null;
      this.previouslyFocusedElement = document.activeElement;

      let modalContainer = document.getElementById('relief-sos-dialog-container');
      if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'relief-sos-dialog-container';
        document.body.appendChild(modalContainer);
      }

      this.renderDialog(modalContainer);

      if (this.triggerBtn) {
        this.triggerBtn.setAttribute('aria-expanded', 'true');
      }

      // Focus management: move focus into dialog safely (to cancel button for safety)
      const cancelBtn = document.getElementById('relief-sos-cancel-btn');
      if (cancelBtn) {
        cancelBtn.focus();
      } else {
        const dialogCard = document.getElementById('relief-sos-dialog');
        if (dialogCard) dialogCard.focus();
      }

      // Attach keyboard navigation listeners
      this.handleKeyDown = this.onKeyDown.bind(this);
      document.addEventListener('keydown', this.handleKeyDown);

      // Announce to screen readers
      this.announce('Emergency SOS confirmation window opened. Confirm to initiate request or press Escape to cancel.');
    }

    /**
     * Closes the dialog and restores focus to trigger button.
     */
    closeDialog(wasCancelled = false) {
      if (this.isSubmitting) return; // Prevent closing while in-flight

      if (wasCancelled && this.state === SOS_STATES.AWAITING_CONFIRMATION) {
        this.state = SOS_STATES.CANCELLED;
      }

      const modalContainer = document.getElementById('relief-sos-dialog-container');
      if (modalContainer) {
        modalContainer.innerHTML = '';
      }

      if (this.triggerBtn) {
        this.triggerBtn.setAttribute('aria-expanded', 'false');
      }

      if (this.handleKeyDown) {
        document.removeEventListener('keydown', this.handleKeyDown);
        this.handleKeyDown = null;
      }

      // Restore focus to the trigger button
      if (this.previouslyFocusedElement && typeof this.previouslyFocusedElement.focus === 'function') {
        this.previouslyFocusedElement.focus();
      }

      this.state = SOS_STATES.IDLE;
      this.announce('Emergency SOS window closed.');
    }

    onKeyDown(event) {
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        this.closeDialog(true);
        return;
      }

      // Focus trapping inside dialog
      if (event.key === 'Tab' || event.keyCode === 9) {
        const dialog = document.getElementById('relief-sos-dialog');
        if (!dialog) return;

        const focusableElements = dialog.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            lastElement.focus();
            event.preventDefault();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            firstElement.focus();
            event.preventDefault();
          }
        }
      }
    }

    announce(text) {
      if (typeof document === 'undefined') return;
      let announcer = document.getElementById('relief-sos-announcer');
      if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = 'relief-sos-announcer';
        announcer.className = 'relief-sos-sr-only';
        announcer.setAttribute('aria-live', 'assertive');
        announcer.setAttribute('aria-atomic', 'true');
        document.body.appendChild(announcer);
      }
      announcer.textContent = text;
    }

    /**
     * Executes the SOS flow after confirmation button is pressed.
     */
    async executeConfirmedSOS() {
      if (this.isSubmitting) return; // Prevent double submission
      this.isSubmitting = true;
      this.state = SOS_STATES.SENDING;

      // Update dialog UI to loading state
      const modalContainer = document.getElementById('relief-sos-dialog-container');
      if (modalContainer) {
        this.renderDialog(modalContainer);
      }

      this.announce('Gathering emergency details. Request is being processed.');

      // Attempt to retrieve location
      let locationData = null;
      try {
        locationData = await fetchLocation({
          timeoutMs: 7000,
          geolocation: this.options.geolocation
        });
        this.activeLocation = locationData;
        this.locationStatus = 'retrieved';
      } catch (locErr) {
        this.activeLocation = null;
        this.locationStatus = locErr.isPermissionDenied ? 'denied' : (locErr.isTimeout ? 'timeout' : 'unavailable');
      }

      // Dispatch to backend
      const payload = {
        urgency: 'HIGH',
        serviceType: 'EMERGENCY_AMBULANCE',
        location: this.activeLocation,
        locationStatus: this.locationStatus,
        region: this.currentRegion,
        clientTimestamp: new Date().toISOString()
      };

      const result = await dispatchSOS(payload, {
        endpoint: this.options.endpoint,
        timeoutMs: this.options.timeoutMs || 10000,
        fetchFn: this.options.fetchFn,
        isOnline: this.options.isOnline
      });

      this.isSubmitting = false;
      this.state = result.state;
      this.lastResult = result;

      // Re-render dialog with honest result
      if (modalContainer) {
        this.renderDialog(modalContainer);
      }

      this.announce(result.message);
    }

    /**
     * Renders the complete, accessible dialog HTML.
     */
    renderDialog(container) {
      const regionData = REGIONAL_EMERGENCY_DATA[this.currentRegion] || REGIONAL_EMERGENCY_DATA.IN;
      const isSending = this.state === SOS_STATES.SENDING;
      const hasResult = this.lastResult !== null;

      const smsInfo = buildSMSFallback({
        recipientNumber: regionData.primaryNumber,
        location: this.activeLocation
      });

      let contentHTML = '';

      if (isSending) {
        contentHTML = `
          <div class="relief-sos-loading-state" role="status" aria-live="polite">
            <div class="relief-sos-spinner" aria-hidden="true"></div>
            <h3 class="relief-sos-loading-title">Processing Emergency SOS...</h3>
            <p class="relief-sos-loading-desc">Checking connectivity, acquiring location, and validating dispatch status.</p>
            <p class="relief-sos-loading-note"><strong>Please do not close this window.</strong> If this is an immediate life-threatening emergency, dial <a href="tel:${regionData.primaryNumber}" class="relief-sos-tel-highlight">${regionData.primaryNumber}</a> now.</p>
          </div>
        `;
      } else if (hasResult) {
        const res = this.lastResult;
        const isSuccess = res.success && res.delivered;
        const bannerClass = isSuccess ? 'relief-sos-banner-success' : (res.state === SOS_STATES.OFFLINE ? 'relief-sos-banner-offline' : 'relief-sos-banner-warning');

        contentHTML = `
          <div class="relief-sos-result-state">
            <div class="relief-sos-status-banner ${bannerClass}" role="alert">
              <div class="relief-sos-status-icon" aria-hidden="true">
                ${isSuccess ? '✓' : '⚠️'}
              </div>
              <div>
                <h3 class="relief-sos-status-title">
                  ${isSuccess ? 'SOS Request Accepted' : (res.state === SOS_STATES.OFFLINE ? 'Device is Offline' : 'Web Dispatch Unavailable')}
                </h3>
                <p class="relief-sos-status-msg">${res.message}</p>
              </div>
            </div>

            <div class="relief-sos-guidance-box">
              <h4>Recommended Action</h4>
              <p>${res.guidance}</p>
            </div>

            <div class="relief-sos-regional-box">
              <h4>Verified Emergency Contacts (${regionData.name})</h4>
              <p class="relief-sos-source-label">${regionData.primarySource}</p>
              <div class="relief-sos-contacts-list">
                ${regionData.services.map(svc => `
                  <div class="relief-sos-contact-item">
                    <div class="relief-sos-contact-info">
                      <span class="relief-sos-contact-name">${svc.name}</span>
                      <span class="relief-sos-contact-src">${svc.source}</span>
                    </div>
                    <a href="tel:${svc.number}" class="relief-sos-btn-call" aria-label="Call ${svc.name} at ${svc.number}">
                      <i class="fas fa-phone-alt" aria-hidden="true"></i> Call ${svc.number}
                    </a>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="relief-sos-fallback-box">
              <h4>Cellular / SMS Fallback (Works Without Internet)</h4>
              <p class="relief-sos-sms-desc">If web connectivity fails, send an urgent SMS with your details directly to the emergency helpline.</p>
              <a href="${smsInfo.smsHref}" class="relief-sos-btn-sms" id="relief-sos-sms-btn" aria-label="Send emergency SMS to ${smsInfo.recipient}">
                <i class="fas fa-comment-medical" aria-hidden="true"></i> Send Emergency SMS (${smsInfo.recipient})
              </a>
            </div>

            <div class="relief-sos-dialog-actions">
              ${!isSuccess ? `
                <button type="button" class="relief-sos-btn relief-sos-btn-retry" id="relief-sos-retry-btn">
                  <i class="fas fa-redo-alt" aria-hidden="true"></i> Retry SOS
                </button>
              ` : ''}
              <button type="button" class="relief-sos-btn relief-sos-btn-close-action" id="relief-sos-close-result-btn">
                Close
              </button>
            </div>
          </div>
        `;
      } else {
        // Confirmation View
        contentHTML = `
          <div class="relief-sos-confirm-state">
            <p id="relief-sos-dialog-desc" class="relief-sos-dialog-desc">
              You are about to initiate an emergency SOS request through the Relief platform.
            </p>

            <div class="relief-sos-info-card">
              <h4>Information Included in Request:</h4>
              <ul class="relief-sos-info-list">
                <li><strong>Device Timestamp:</strong> Current local time.</li>
                <li><strong>GPS Location:</strong> Latitude and longitude coordinates (if permission is granted).</li>
                <li><strong>Emergency Type:</strong> Urgent medical assistance / Ambulance request.</li>
                <li><strong>Network Status:</strong> Current device connection status.</li>
              </ul>
            </div>

            <div class="relief-sos-location-notice">
              <span class="relief-sos-notice-icon" aria-hidden="true">📍</span>
              <div>
                <strong>Location Permission:</strong> Your browser will prompt for location access after confirmation. If permission is denied or unavailable, you will still receive full emergency numbers and fallback options.
              </div>
            </div>

            <div class="relief-sos-region-select-wrap">
              <label for="relief-sos-region-picker" class="relief-sos-region-label">Selected Emergency Region:</label>
              <select id="relief-sos-region-picker" class="relief-sos-region-select" aria-label="Select emergency region">
                ${Object.keys(REGIONAL_EMERGENCY_DATA).map(code => `
                  <option value="${code}" ${code === this.currentRegion ? 'selected' : ''}>
                    ${REGIONAL_EMERGENCY_DATA[code].name} (${REGIONAL_EMERGENCY_DATA[code].primaryNumber})
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="relief-sos-disclaimer-box" role="note">
              <span class="relief-sos-disclaimer-badge">CRITICAL SAFETY NOTICE</span>
              <p>${EMERGENCY_DISCLAIMER}</p>
            </div>

            <div class="relief-sos-dialog-actions">
              <button type="button" class="relief-sos-btn relief-sos-btn-confirm" id="relief-sos-confirm-btn" aria-label="Confirm Emergency SOS Request">
                <i class="fas fa-exclamation-circle" aria-hidden="true"></i> Confirm & Send SOS
              </button>
              <button type="button" class="relief-sos-btn relief-sos-btn-cancel" id="relief-sos-cancel-btn" aria-label="Cancel Emergency SOS">
                Cancel
              </button>
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        <div class="relief-sos-backdrop" id="relief-sos-backdrop"></div>
        <div class="relief-sos-dialog-wrapper" role="presentation">
          <div class="relief-sos-dialog" id="relief-sos-dialog" role="dialog" aria-modal="true" aria-labelledby="relief-sos-dialog-title" aria-describedby="relief-sos-dialog-desc" tabindex="-1">
            <div class="relief-sos-dialog-header">
              <div class="relief-sos-header-title-wrap">
                <span class="relief-sos-header-badge" aria-hidden="true">SOS</span>
                <h2 id="relief-sos-dialog-title" class="relief-sos-dialog-title">Emergency SOS</h2>
              </div>
              <button type="button" class="relief-sos-btn-close" id="relief-sos-close-btn" aria-label="Close emergency window" ${isSending ? 'disabled' : ''}>
                &times;
              </button>
            </div>
            <div class="relief-sos-dialog-body">
              ${contentHTML}
            </div>
          </div>
        </div>
      `;

      // Bind dynamic event listeners
      this.bindDialogEvents();
    }

    bindDialogEvents() {
      const backdrop = document.getElementById('relief-sos-backdrop');
      if (backdrop && !this.isSubmitting) {
        backdrop.addEventListener('click', () => this.closeDialog(true));
      }

      const closeBtn = document.getElementById('relief-sos-close-btn');
      if (closeBtn && !this.isSubmitting) {
        closeBtn.addEventListener('click', () => this.closeDialog(true));
      }

      const cancelBtn = document.getElementById('relief-sos-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => this.closeDialog(true));
      }

      const confirmBtn = document.getElementById('relief-sos-confirm-btn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => this.executeConfirmedSOS());
      }

      const retryBtn = document.getElementById('relief-sos-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => this.executeConfirmedSOS());
      }

      const closeResultBtn = document.getElementById('relief-sos-close-result-btn');
      if (closeResultBtn) {
        closeResultBtn.addEventListener('click', () => this.closeDialog(false));
      }

      const regionPicker = document.getElementById('relief-sos-region-picker');
      if (regionPicker) {
        regionPicker.addEventListener('change', (e) => {
          this.currentRegion = e.target.value;
          const container = document.getElementById('relief-sos-dialog-container');
          if (container) this.renderDialog(container);
        });
      }
    }
  }

  let defaultInstance = null;
  function getOrInitDefault(options) {
    if (!defaultInstance && typeof document !== 'undefined') {
      defaultInstance = new EmergencySOSController(options || {
        triggerId: 'relief-emergency-sos-trigger',
        defaultRegion: 'IN'
      });
      if (typeof window !== 'undefined') {
        window._reliefSOSInstance = defaultInstance;
      }
    }
    return defaultInstance;
  }

  if (typeof document !== 'undefined') {
    const runAutoInit = () => {
      const triggerBtn = document.getElementById('relief-emergency-sos-trigger');
      if (triggerBtn) {
        getOrInitDefault({
          triggerId: 'relief-emergency-sos-trigger',
          defaultRegion: 'IN'
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runAutoInit);
    } else {
      runAutoInit();
    }
  }

  // Exported API
  return {
    SOS_STATES,
    REGIONAL_EMERGENCY_DATA,
    EMERGENCY_DISCLAIMER,
    buildSMSFallback,
    fetchLocation,
    dispatchSOS,
    EmergencySOSController,
    init: function (options) {
      return getOrInitDefault(options);
    },
    openDialog: function () {
      const inst = getOrInitDefault();
      if (inst) inst.openConfirmationDialog();
    }
  };
});
