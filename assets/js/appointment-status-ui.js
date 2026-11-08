/**
 * Shows the user's appointment requests with their status and lets them cancel one.
 * Mounts into #my-requests-list on pages/appointments.html.
 *
 * Only safe fields are shown (reference, doctor, date, window, status). The email, phone number
 * and notes a user typed stay in storage and are never put on this list.
 * All text is inserted with textContent. Rules live in appointment-status.js.
 */
(function () {
  'use strict';

  var Request = window.ReliefAppointmentRequest;
  var Status = window.ReliefAppointmentStatus;
  var list = document.getElementById('my-requests-list');
  var statusRegion = document.getElementById('my-requests-status');
  if (!Request || !Status || !list) return;

  var WINDOW_LABELS = {};
  Object.keys(Request.TIME_WINDOWS || {}).forEach(function (key) {
    WINDOW_LABELS[key] = Request.TIME_WINDOWS[key].label;
  });

  // The request whose "are you sure" box is open, so a re-render keeps it open.
  var confirming = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function announce(message) {
    statusRegion.textContent = message;
    statusRegion.hidden = !message;
  }

  function formatDate(iso) {
    var d = Request.parseDate ? Request.parseDate(iso) : null;
    if (!d) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderItem(item) {
    var li = el('li', 'request-item request-' + item.tone);
    li.setAttribute('data-request-id', item.id);
    li.tabIndex = -1; // so focus can land here after a cancellation removes the button

    var head = el('div', 'request-head');
    head.appendChild(el('strong', 'request-reference', item.reference));
    head.appendChild(el('span', 'request-pill', item.statusLabel));
    li.appendChild(head);

    var line = item.doctorName + (item.specialty ? ' (' + item.specialty + ')' : '');
    li.appendChild(el('p', 'request-doctor', line));
    var when = formatDate(item.preferredDate) + (WINDOW_LABELS[item.preferredWindow] ? ', ' + WINDOW_LABELS[item.preferredWindow] : '');
    li.appendChild(el('p', 'request-when', 'Preferred: ' + when));
    li.appendChild(el('p', 'request-description', item.statusDescription));

    if (item.canCancel) {
      if (confirming === item.id) {
        li.appendChild(renderConfirm(item));
      } else {
        var cancel = el('button', 'btn-cancel-request', 'Cancel request');
        cancel.type = 'button';
        cancel.setAttribute('data-action', 'cancel');
        cancel.setAttribute('aria-label', 'Cancel request ' + item.reference);
        li.appendChild(cancel);
      }
    }
    return li;
  }

  function renderConfirm(item) {
    var box = el('div', 'request-confirm');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Confirm cancelling request ' + item.reference);
    box.appendChild(el('p', 'request-confirm-text', 'Cancel request ' + item.reference + '?'));
    box.appendChild(el('p', 'request-confirm-note', Status.CANCEL_NOTE));

    var yes = el('button', 'btn-confirm-cancel', 'Yes, cancel request');
    yes.type = 'button';
    yes.setAttribute('data-action', 'confirm-cancel');
    var no = el('button', 'btn-keep-request', 'Keep request');
    no.type = 'button';
    no.setAttribute('data-action', 'keep');
    box.appendChild(yes);
    box.appendChild(no);
    return box;
  }

  function render(focusSelector) {
    var items = Status.toDisplayList(Request.loadRequests(window.localStorage));
    list.textContent = '';
    if (items.length === 0) {
      list.appendChild(el('li', 'request-empty', 'You have not sent any appointment requests from this device.'));
      return;
    }
    items.forEach(function (item) { list.appendChild(renderItem(item)); });
    if (focusSelector) {
      var target = list.querySelector(focusSelector);
      if (target) target.focus();
    }
  }

  function saveAll(requests) {
    try {
      window.localStorage.setItem(Request.STORAGE_KEY, JSON.stringify(requests));
      return true;
    } catch (e) {
      return false;
    }
  }

  function cancel(id) {
    var result = Status.cancelRequest(Request.loadRequests(window.localStorage), id, new Date());
    if (!result.ok) {
      announce(result.message);
      confirming = null;
      render();
      return;
    }
    if (!saveAll(result.requests)) {
      announce('The cancellation could not be saved because browser storage is unavailable or full. The request was not changed.');
      confirming = null;
      render();
      return;
    }
    confirming = null;
    render('[data-request-id="' + id + '"]');
    announce('Request ' + Status.displayReference(id) + ' was cancelled. You can send a new request at any time.');
  }

  list.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var item = button.closest('[data-request-id]');
    var id = item && item.getAttribute('data-request-id');
    var action = button.getAttribute('data-action');

    if (action === 'cancel') {
      confirming = id;
      announce('');
      render('[data-request-id="' + id + '"] .btn-confirm-cancel');
    } else if (action === 'keep') {
      confirming = null;
      render('[data-request-id="' + id + '"] .btn-cancel-request');
    } else if (action === 'confirm-cancel') {
      cancel(id);
    }
  });

  // Escape closes an open "are you sure" box.
  list.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && confirming) {
      var id = confirming;
      confirming = null;
      render('[data-request-id="' + id + '"] .btn-cancel-request');
    }
  });

  document.addEventListener('relief:request-saved', function () { render(); });
  document.addEventListener('relief:data-deleted', function () { confirming = null; announce(''); render(); });

  render();
})();
