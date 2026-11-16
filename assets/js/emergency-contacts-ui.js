/**
 * Page script for pages/emergency-contacts.html. Needs emergency-sos.js (the data) and
 * emergency-contacts.js (the checks) loaded first.
 *
 * Works without sign-in and without location permission. The region is picked from the browser
 * language as a first guess and can always be changed. Numbers are rendered as ordinary tel: links:
 * nothing is dialled until the person taps one.
 */
(function () {
  'use strict';

  var NOT_LISTED = 'other';
  var Contacts = window.EmergencyContacts;
  var data = window.EmergencySOS && window.EmergencySOS.REGIONAL_EMERGENCY_DATA;

  var select = document.getElementById('region-select');
  var hint = document.getElementById('region-hint');
  var status = document.getElementById('contacts-status');
  var results = document.getElementById('contacts-results');
  var unavailable = document.getElementById('contacts-unavailable');
  var form = document.getElementById('region-form');
  if (!select || !results || !Contacts) return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function sourceLine(entry) {
    var p = el('p', 'contact-source');
    p.appendChild(document.createTextNode('Source: '));
    if (entry.sourceUrl) {
      var a = el('a', null, entry.source);
      a.href = entry.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      p.appendChild(a);
    } else {
      p.appendChild(document.createTextNode(entry.source + ' (no link recorded yet)'));
    }
    return p;
  }

  function card(entry) {
    var li = el('li', 'contact-card');
    li.appendChild(el('h4', 'contact-service', entry.name));

    // A plain link: the phone shows its own dialer and the person decides whether to call.
    var call = el('a', 'contact-call', 'Call ' + entry.number);
    call.href = entry.telHref;
    call.setAttribute('aria-label', 'Call ' + entry.number + ', ' + entry.name + '. Opens your phone dialer.');
    li.appendChild(call);

    li.appendChild(sourceLine(entry));
    var badge = el('p', 'contact-status', entry.status.label);
    badge.setAttribute('data-state', entry.status.state);
    li.appendChild(badge);
    return li;
  }

  function group(title, entries, emptyText) {
    var section = el('section', 'contact-group');
    section.appendChild(el('h3', null, title));
    if (!entries.length) {
      section.appendChild(el('p', 'muted contact-empty', emptyText));
      return section;
    }
    var ul = el('ul', 'contact-list');
    entries.forEach(function (entry) { ul.appendChild(card(entry)); });
    section.appendChild(ul);
    return section;
  }

  function showRegion(code) {
    var found = Contacts.lookup(data, code);
    clear(results);
    if (!found.ok) {
      showOverview(found.reason);
      return;
    }
    status.textContent = 'Showing emergency numbers for ' + found.region.name + '.';
    results.appendChild(group('National numbers', found.national, 'No national numbers are published for this region yet.'));
    results.appendChild(group('Local contacts', found.local,
      'No local contacts are published for ' + found.region.name + ' yet. A local number is only added with an official source.'));
  }

  // No region chosen, "not listed", or a code the data does not have: show every number we do have,
  // clearly labelled by region, so nothing is guessed on the person's behalf.
  function showOverview(reason) {
    var message = reason === 'unknown-region'
      ? 'That region is not in this list, so no number is picked for you. These are all the numbers we have, by region. Check your own country’s official emergency number if yours is not here.'
      : 'Choose your region to see its emergency numbers, or look through every region below.';
    status.textContent = message;
    Contacts.listRegions(data).forEach(function (region) {
      var found = Contacts.lookup(data, region.code);
      if (!found.ok) return;
      results.appendChild(group(found.region.name, found.national.concat(found.local), 'No numbers published.'));
    });
  }

  function showUnavailable() {
    if (unavailable) unavailable.hidden = false;
    if (form) form.hidden = true;
    status.textContent = 'The list of emergency numbers could not be loaded.';
    clear(results);
  }

  function choose(value) {
    if (value === '') {
      showOverview('none');
    } else {
      showRegion(value);
    }
  }

  var regions = data ? Contacts.listRegions(data) : [];
  if (!regions.length) {
    showUnavailable();
    return;
  }

  regions.forEach(function (region) {
    var option = el('option', null, region.name);
    option.value = region.code;
    select.appendChild(option);
  });
  var other = el('option', null, 'My region is not listed');
  other.value = NOT_LISTED;
  select.appendChild(other);

  var guess = Contacts.regionFromLocale(navigator.language, data);
  if (guess) {
    select.value = guess;
    hint.textContent = 'Chosen from your browser language. Change it if this is not where you are. Your location is never used.';
  } else {
    select.value = '';
    hint.textContent = 'We could not tell your region from your browser. Choose it from the list.';
  }

  select.addEventListener('change', function () { choose(select.value); });
  if (form) form.addEventListener('submit', function (event) { event.preventDefault(); });
  choose(select.value);
})();
