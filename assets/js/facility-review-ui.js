/**
 * Admin panel view: which facility records need a check (#facility-freshness).
 * Read only. It loads the same public facilities.json the directory uses and shows
 * the queue worked out by facility-review.js. Review states are changed with
 * scripts/facility-review.js and a pull request, never from this page.
 * Everything is drawn with textContent.
 */
(function () {
    'use strict';

    var U = window.FacilityUtils;
    var R = window.FacilityReview;
    var section = document.getElementById('facility-freshness');
    if (!U || !R || !section) return;

    var DATA_URL = '../assets/data/facilities.json';
    var PAGE_SIZE = 25;
    var STATE_TEXT = { stale: 'Stale', pending: 'Pending', verified: 'Verified', rejected: 'Rejected' };

    var counts = document.getElementById('freshness-counts');
    var message = document.getElementById('freshness-message');
    var filter = document.getElementById('freshness-filter');
    var wrap = document.getElementById('freshness-table-wrap');
    var body = document.getElementById('freshness-rows');
    var more = document.getElementById('freshness-more');
    var windowText = document.getElementById('freshness-window');

    var data = null;
    var showAll = false;

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function setMessage(text, tone) {
        message.textContent = text;
        message.setAttribute('data-tone', tone || '');
    }

    function cell(row, text, className) {
        var td = make('td', className, text);
        row.appendChild(td);
        return td;
    }

    function render() {
        var facilities = U.normalizeFacilities(data);
        var policy = U.getReviewPolicy(data);
        var opts = { policy: policy };

        windowText.textContent = String(policy.maxAgeDays);
        var types = Object.keys(policy.byType);
        if (types.length) windowText.textContent += ' (' + types.map(function (t) { return t + ': ' + policy.byType[t]; }).join(', ') + ')';

        var summary = R.summary(facilities, opts);
        counts.textContent = '';
        ['verified', 'stale', 'pending', 'rejected'].forEach(function (state) {
            var item = make('li', 'freshness-count freshness-count--' + state);
            item.appendChild(make('strong', null, String(summary[state])));
            item.appendChild(make('span', null, ' ' + STATE_TEXT[state].toLowerCase()));
            counts.appendChild(item);
        });

        var queue = R.queue(facilities, opts);
        var want = filter.value;
        var rows = want === 'all' ? queue : queue.filter(function (i) { return i.state === want; });

        body.textContent = '';
        if (!rows.length) {
            wrap.hidden = true;
            more.hidden = true;
            setMessage(want === 'stale' && !queue.length ? 'No record needs a check.' : 'No records in this list.', 'ok');
            return;
        }
        wrap.hidden = false;
        var shown = showAll ? rows : rows.slice(0, PAGE_SIZE);
        shown.forEach(function (item) {
            var tr = make('tr');
            cell(tr, item.name);
            var state = make('td');
            state.appendChild(make('span', 'freshness-state freshness-state--' + item.state, STATE_TEXT[item.state]));
            tr.appendChild(state);
            cell(tr, item.lastChecked || 'never');
            cell(tr, item.ageDays == null ? '-' : item.ageDays + ' days');
            cell(tr, item.source || '-');
            body.appendChild(tr);
        });
        more.hidden = rows.length <= PAGE_SIZE;
        more.textContent = showAll ? 'Show fewer' : 'Show all ' + rows.length;
        setMessage(rows.length + ' of ' + facilities.length + ' records need a check. Showing ' + shown.length + ', oldest check first.', '');
    }

    filter.addEventListener('change', function () { showAll = false; render(); });
    more.addEventListener('click', function () { showAll = !showAll; render(); });

    setMessage('Loading facility records...', '');
    fetch(DATA_URL)
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (json) { data = json; render(); })
        .catch(function () { setMessage('The facility file could not be loaded, so freshness is unknown.', 'error'); });
})();
