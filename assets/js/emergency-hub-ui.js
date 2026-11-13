/**
 * Page script for pages/emergency-hub.html. Needs emergency-sos.js (the numbers) and emergency-hub.js
 * (the checks) loaded first. Works without sign-in and without location permission. Numbers are
 * ordinary tel: links, so nothing is dialled until the person taps one.
 */
(function () {
  'use strict';

  var HUB = window.EmergencyHub;
  var contacts = window.EmergencySOS && window.EmergencySOS.REGIONAL_EMERGENCY_DATA;
  var DATA_URL = '../assets/data/emergency-hub.json';
  var TIMEOUT_MS = 8000;

  var $ = function (id) { return document.getElementById(id); };
  var form = $('hub-form');
  var search = $('hub-search');
  var typeSel = $('hub-type');
  var audienceSel = $('hub-audience');
  var status = $('hub-status');
  var results = $('hub-results');
  var loading = $('hub-loading');
  var unavailable = $('hub-unavailable');
  var empty = $('hub-empty');
  var nomatch = $('hub-nomatch');
  var nomatchQuery = $('hub-nomatch-query');
  var owner = $('hub-owner');
  var helpNow = $('hub-help-numbers');
  if (!results || !HUB) return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderHelpNumbers() {
    var list = HUB.primaryNumbers(contacts);
    clear(helpNow);
    if (!list.length) {
      helpNow.appendChild(el('li', 'muted', 'The numbers could not be loaded. Dial the emergency number for the country you are in from your phone’s keypad.'));
      return;
    }
    list.forEach(function (n) {
      var li = el('li');
      var a = el('a', 'hub-call', 'Call ' + n.number);
      a.href = n.telHref;
      a.setAttribute('aria-label', 'Call ' + n.number + ', ' + n.name + '. Opens your phone dialer.');
      li.appendChild(a);
      li.appendChild(el('span', 'hub-call-region', n.name));
      helpNow.appendChild(li);
    });
  }

  function card(r) {
    var li = el('li', 'hub-card');
    var tags = el('p', 'hub-tags');
    tags.appendChild(el('span', 'hub-tag', r.audienceLabel));
    if (r.region) tags.appendChild(el('span', 'hub-tag', r.region));
    li.appendChild(tags);
    li.appendChild(el('h4', 'hub-title', r.title));
    if (r.summary) li.appendChild(el('p', 'hub-summary', r.summary));

    if (r.kind === 'contact') {
      var call = el('a', 'hub-call', 'Call ' + r.number);
      call.href = r.telHref;
      call.setAttribute('aria-label', 'Call ' + r.number + ', ' + r.title + '. Opens your phone dialer.');
      li.appendChild(call);
    } else {
      var open = el('a', 'hub-open', 'Open');
      open.href = r.href;
      open.setAttribute('aria-label', 'Open ' + r.title);
      li.appendChild(open);
    }

    var source = el('p', 'hub-source', 'Source: ');
    if (r.sourceUrl) {
      var a = el('a', null, r.source);
      a.href = r.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      source.appendChild(a);
    } else {
      source.appendChild(document.createTextNode(r.source));
    }
    li.appendChild(source);

    var badge = el('p', 'hub-review', r.review.label);
    badge.setAttribute('data-state', r.review.state);
    li.appendChild(badge);
    return li;
  }

  function fillSelect(select, anyLabel, items) {
    clear(select);
    var any = el('option', null, anyLabel);
    any.value = '';
    select.appendChild(any);
    items.forEach(function (item) {
      var o = el('option', null, item.label);
      o.value = item.id;
      select.appendChild(o);
    });
  }

  function show(node, visible) { if (node) node.hidden = !visible; }

  function start(hub) {
    var built = HUB.build(hub, contacts);
    show(loading, false);
    if (!built.ok) {
      show(unavailable, true);
      show(form, false);
      status.textContent = 'The resource list could not be loaded.';
      return;
    }

    fillSelect(typeSel, 'All emergency types', built.types);
    fillSelect(audienceSel, 'All audiences', built.audiences);
    if (owner) {
      owner.textContent = 'Kept by: ' + (built.owner || 'not assigned yet') + '. Each resource should be reviewed at least every ' + built.cadenceDays + ' days.';
    }

    function render() {
      var query = HUB.normalizeQuery(search.value);
      var found = HUB.filter(built.resources, { query: query, type: typeSel.value, audience: audienceSel.value });
      clear(results);
      HUB.groupByType(found, built.types).forEach(function (group) {
        var section = el('section', 'hub-group');
        section.appendChild(el('h3', null, group.type.label));
        var ul = el('ul', 'hub-list');
        group.items.forEach(function (r) { ul.appendChild(card(r)); });
        section.appendChild(ul);
        results.appendChild(section);
      });

      var none = built.resources.length === 0;
      show(empty, none);
      show(nomatch, !none && found.length === 0);
      nomatchQuery.textContent = query;
      var needReview = found.filter(function (r) { return r.review.needsReview; }).length;
      if (none) {
        status.textContent = 'No resources have been published yet.';
      } else if (!found.length) {
        status.textContent = 'No resource matches your search and filters.';
      } else {
        status.textContent = 'Showing ' + found.length + (found.length === 1 ? ' resource' : ' resources') +
          (needReview ? ', ' + needReview + ' not reviewed or overdue for review.' : '. All are within their review period.');
      }
    }

    search.addEventListener('input', render);
    typeSel.addEventListener('change', render);
    audienceSel.addEventListener('change', render);
    form.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    render();
  }

  renderHelpNumbers();

  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = controller ? window.setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
  fetch(DATA_URL, controller ? { signal: controller.signal } : undefined)
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(start, function () { start(null); })
    .then(function () { if (timer) window.clearTimeout(timer); });
})();
