/**
 * Page script for pages/emergency-directory.html. Needs emergency-sos.js (the numbers) and
 * emergency-directory.js (the entries and search) loaded first.
 *
 * Works without sign-in and without location permission. Numbers are ordinary tel: links, so nothing
 * is dialled until the person taps one.
 */
(function () {
  'use strict';

  var Directory = window.EmergencyDirectory;
  var data = window.EmergencySOS && window.EmergencySOS.REGIONAL_EMERGENCY_DATA;

  var form = document.getElementById('directory-form');
  var input = document.getElementById('directory-search');
  var status = document.getElementById('directory-status');
  var list = document.getElementById('directory-results');
  var empty = document.getElementById('directory-empty');
  var emptyQuery = document.getElementById('directory-empty-query');
  var unavailable = document.getElementById('directory-unavailable');
  var clearBtn = document.getElementById('directory-clear');
  if (!input || !list || !Directory) return;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function helplineItem(entry) {
    var li = el('li', 'dir-card');
    li.appendChild(el('span', 'dir-kind', 'Helpline, ' + entry.region.name));
    li.appendChild(el('h3', 'dir-title', entry.title));

    var call = el('a', 'dir-call', 'Call ' + entry.number);
    call.href = entry.telHref;
    call.setAttribute('aria-label', 'Call ' + entry.number + ', ' + entry.title + '. Opens your phone dialer.');
    li.appendChild(call);

    var source = el('p', 'dir-source');
    source.appendChild(document.createTextNode('Source: '));
    if (entry.sourceUrl) {
      var a = el('a', null, entry.source);
      a.href = entry.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      source.appendChild(a);
    } else {
      source.appendChild(document.createTextNode(entry.source));
    }
    li.appendChild(source);

    var checked = el('p', 'dir-checked', entry.checked.label);
    checked.setAttribute('data-state', entry.checked.state);
    li.appendChild(checked);
    return li;
  }

  function siteItem(entry) {
    var li = el('li', 'dir-card');
    li.appendChild(el('span', 'dir-kind', 'On RELIEF'));
    li.appendChild(el('h3', 'dir-title', entry.title));
    li.appendChild(el('p', 'dir-summary', entry.summary));
    var open = el('a', 'dir-open', 'Open');
    open.href = entry.href;
    open.setAttribute('aria-label', 'Open ' + entry.title);
    li.appendChild(open);
    return li;
  }

  var built = Directory.buildEntries(data);
  var entries = built.ok ? built.entries : built.siteEntries;
  if (!built.ok) {
    // The numbers could not be loaded. The pages of this site are still searchable.
    unavailable.hidden = false;
  }

  function render() {
    var query = Directory.normalizeQuery(input.value);
    var found = Directory.search(entries, query);
    clear(list);
    found.forEach(function (entry) {
      list.appendChild(entry.kind === 'helpline' ? helplineItem(entry) : siteItem(entry));
    });
    empty.hidden = found.length > 0;
    list.hidden = found.length === 0;
    if (!found.length) {
      emptyQuery.textContent = query;
      status.textContent = 'No resource matches "' + query + '".';
    } else if (query === '') {
      status.textContent = 'Showing all ' + found.length + ' resources.';
    } else {
      status.textContent = found.length + (found.length === 1 ? ' resource matches "' : ' resources match "') + query + '".';
    }
    if (clearBtn) clearBtn.hidden = input.value === '';
  }

  input.addEventListener('input', render);
  if (form) form.addEventListener('submit', function (event) { event.preventDefault(); render(); });
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      render();
      input.focus();
    });
  }
  render();
})();
