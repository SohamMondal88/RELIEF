/**
 * Location panel: explains why location is useful, lets the user share their
 * position or type a place instead, and announces the result.
 * Mounts into #location-panel and fires "relief:location-changed" on document.
 */
(function () {
  'use strict';

  function init() {
    var host = document.getElementById('location-panel');
    var RL = window.ReliefLocation;
    if (!host || !RL) return;

    host.innerHTML =
      '<h2 class="location-panel-title">Your location</h2>' +
      '<p class="location-panel-why">We use your location only to centre the map and show what is closest. ' +
        'It stays in this browser, is rounded to about 1 km, and expires automatically. ' +
        'Nothing is requested until you press a button, and you can use this page without sharing it.</p>' +
      '<p id="location-current" class="location-current" role="status" aria-live="polite"></p>' +
      '<div class="location-actions">' +
        '<button type="button" id="location-use-gps" class="btn-filter">Use my current location</button>' +
        '<button type="button" id="location-clear" class="btn-filter" hidden>Clear saved location</button>' +
      '</div>' +
      '<form id="location-form" class="location-form" novalidate>' +
        '<label for="location-input">Or enter a town, village, PIN code or address</label>' +
        '<input type="text" id="location-input" list="location-places" autocomplete="off" maxlength="120" aria-describedby="location-error">' +
        '<datalist id="location-places"></datalist>' +
        '<button type="submit" class="btn-filter">Set location</button>' +
      '</form>' +
      '<p id="location-error" class="location-error" role="alert"></p>';

    var current = host.querySelector('#location-current');
    var errorEl = host.querySelector('#location-error');
    var gpsBtn = host.querySelector('#location-use-gps');
    var clearBtn = host.querySelector('#location-clear');
    var form = host.querySelector('#location-form');
    var input = host.querySelector('#location-input');
    var list = host.querySelector('#location-places');

    RL.KNOWN_PLACES.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.label;
      list.appendChild(opt);
    });

    function describe(loc) {
      if (!loc) return 'No location set. Showing West Bengal. Distances are not available until you set a location.';
      if (loc.source === 'manual') return 'Using your chosen location: ' + (loc.label || 'entered place') + '. You can change it below.';
      return 'Using your detected location (approximate). If it looks wrong, enter a place below.';
    }

    function refresh() {
      var loc = RL.loadLocation();
      current.textContent = describe(loc);
      clearBtn.hidden = !loc;
      return loc;
    }

    function announce(loc) {
      document.dispatchEvent(new CustomEvent('relief:location-changed', { detail: loc }));
    }

    function setBusy(busy) {
      gpsBtn.disabled = busy;
      gpsBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    gpsBtn.addEventListener('click', function () {
      errorEl.textContent = '';
      current.textContent = 'Finding your location...';
      setBusy(true);
      RL.getPositionWithRetry({ retries: 1, timeout: 10000 }).then(function (pos) {
        var saved = RL.saveLocation(pos);
        setBusy(false);
        refresh();
        announce(saved);
      }).catch(function (err) {
        setBusy(false);
        refresh();
        errorEl.textContent = err && err.reason ? err.message : RL.messageFor('unavailable');
        input.focus();
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.textContent = '';
      current.textContent = 'Looking up that place...';
      RL.resolveManualLocation(input.value).then(function (loc) {
        var saved = RL.saveLocation(loc);
        input.value = '';
        refresh();
        announce(saved);
      }).catch(function (err) {
        refresh();
        errorEl.textContent = err && err.reason ? err.message : RL.messageFor('notfound');
        input.focus();
      });
    });

    clearBtn.addEventListener('click', function () {
      RL.clearLocation();
      errorEl.textContent = '';
      refresh();
      announce(null);
      gpsBtn.focus();
    });

    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
