/* Connect the health-events rules to the public page and moderation panel. */
(function () {
    'use strict';

    var H = window.HealthEvents;
    if (!H) return;

    var DATA_URL = '../assets/data/health-events.json';

    function el(id) { return document.getElementById(id); }

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function safeStorage() {
        try {
            var probe = '__relief_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return window.localStorage;
        } catch (e) {
            return null;
        }
    }

    // Demo mode is for local development and explicit demos only.
    function isDemo() {
        if (!window.ReliefAuth || typeof window.ReliefAuth.isDemoMode !== 'function') return false;
        var meta = document.querySelector('meta[name="relief-demo-mode"]');
        return window.ReliefAuth.isDemoMode({
            hostname: window.location.hostname,
            protocol: window.location.protocol,
            flag: window.RELIEF_DEMO_MODE,
            metaContent: meta ? meta.getAttribute('content') : ''
        });
    }

    function makeStore() {
        return H.createStore({ api: window.ReliefAPI || null, storage: safeStorage(), demo: isDemo() });
    }

    var IST = { timeZone: 'Asia/Kolkata' };

    function formatDate(ms) {
        return new Date(ms).toLocaleDateString('en-IN', Object.assign({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }, IST));
    }

    function formatTime(ms) {
        return new Date(ms).toLocaleTimeString('en-IN', Object.assign({ hour: 'numeric', minute: '2-digit' }, IST));
    }

    function formatStamp(iso) {
        var t = H.parseInstant(iso);
        if (!isFinite(t)) t = Date.parse(iso);
        return isFinite(t) ? new Date(t).toLocaleString('en-IN', Object.assign({ dateStyle: 'medium', timeStyle: 'short' }, IST)) : '';
    }

    // Show a simple single-day or multi-day time range.
    function describeWhen(event) {
        var start = H.parseInstant(event.startsAt);
        var end = H.parseInstant(event.endsAt);
        if (!isFinite(end)) return formatDate(start) + ', from ' + formatTime(start) + ' IST';
        if (H.istDate(start) === H.istDate(end)) {
            return formatDate(start) + ', ' + formatTime(start) + ' to ' + formatTime(end) + ' IST';
        }
        return formatDate(start) + ' ' + formatTime(start) + ' to ' + formatDate(end) + ' ' + formatTime(end) + ' IST';
    }

    // Do not turn unsafe links into clickable links.
    function safeHref(url) {
        try {
            var parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
        } catch (e) {
            return null;
        }
    }

    function detail(list, label, value) {
        if (!value) return;
        var dt = make('dt', null, label);
        var dd = make('dd');
        if (typeof value === 'string') dd.textContent = value; else dd.appendChild(value);
        list.appendChild(dt);
        list.appendChild(dd);
    }

    var STATE_LABELS = { upcoming: 'Upcoming', ongoing: 'Happening now', past: 'Past event' };

    function renderEvent(event, now) {
        var state = H.timeState(event, now);
        var confirmed = H.isConfirmed(event);
        var item = make('li', 'event-card' + (confirmed ? '' : ' event-card--unverified') + (state === 'past' ? ' event-card--past' : ''));
        item.dataset.eventId = event.id;

        var badges = make('p', 'event-badges');
        badges.appendChild(make('span', 'event-badge event-badge--' + (confirmed ? 'confirmed' : 'unverified'), confirmed ? 'Confirmed' : 'Unverified'));
        badges.appendChild(make('span', 'event-badge event-badge--' + state, STATE_LABELS[state]));
        badges.appendChild(make('span', 'event-badge event-badge--type', H.TYPES[event.type] || 'Event'));
        if (event.sample) badges.appendChild(make('span', 'event-badge event-badge--sample', 'Sample'));
        if (event.demo) badges.appendChild(make('span', 'event-badge event-badge--sample', 'Demo'));
        item.appendChild(badges);

        item.appendChild(make('h3', 'event-title', event.title));

        if (!confirmed) {
            item.appendChild(make('p', 'event-warning', 'Not yet checked by RELIEF. Call the organiser to confirm before you travel.'));
        } else if (state === 'past') {
            item.appendChild(make('p', 'event-warning event-warning--past', 'This event has ended.'));
        }

        var list = make('dl', 'event-details');
        detail(list, 'When', describeWhen(event));
        detail(list, 'Where', [event.venue, event.district].filter(Boolean).join(', '));
        detail(list, 'Organiser', event.organiser);
        if (event.services.length) {
            var ul = make('ul', 'event-services');
            event.services.forEach(function (s) { ul.appendChild(make('li', null, s)); });
            detail(list, 'Services', ul);
        }
        detail(list, 'Who can attend', event.eligibility);

        if (event.contactPhone || event.contactEmail) {
            var contact = make('span');
            if (event.contactPhone) {
                var tel = make('a', null, event.contactPhone);
                tel.href = 'tel:' + event.contactPhone.replace(/[^\d+]/g, '');
                contact.appendChild(tel);
            }
            if (event.contactEmail) {
                if (event.contactPhone) contact.appendChild(document.createTextNode(' · '));
                var mail = make('a', null, event.contactEmail);
                mail.href = 'mailto:' + event.contactEmail;
                contact.appendChild(mail);
            }
            detail(list, 'Contact', contact);
        }
        var href = safeHref(event.sourceUrl);
        if (href) {
            var link = make('a', null, 'Official notice');
            link.href = href;
            link.rel = 'noopener noreferrer nofollow';
            link.target = '_blank';
            detail(list, 'Source', link);
        }
        item.appendChild(list);

        var updated = make('p', 'event-updated');
        if (event.lastUpdated) {
            updated.appendChild(document.createTextNode('Last updated: '));
            var time = make('time', null, formatStamp(event.lastUpdated));
            time.setAttribute('datetime', event.lastUpdated);
            updated.appendChild(time);
            if (confirmed && event.verifiedBy) updated.appendChild(document.createTextNode(' · Checked by ' + event.verifiedBy));
        } else {
            updated.textContent = 'Last updated: not known';
        }
        item.appendChild(updated);
        return item;
    }

    // Public event list

    function initList() {
        var listNode = el('events-list');
        if (!listNode) return;

        var form = el('events-filter-form');
        var loading = el('events-loading');
        var errorBox = el('events-error');
        var empty = el('events-empty');
        var summary = el('events-summary');
        var past = el('events-past');
        var pastList = el('events-past-list');
        var pastCount = el('events-past-count');
        var store = makeStore();
        var events = [];
        var seedEvents = [];

        function filters() {
            return {
                location: el('filter-location').value,
                type: el('filter-type').value,
                from: el('filter-from').value,
                to: el('filter-to').value,
                includeUnverified: el('filter-unverified').checked
            };
        }

        function showFilterErrors(errors) {
            ['from', 'to'].forEach(function (name) {
                var input = el('filter-' + name);
                el('filter-error-' + name).textContent = errors[name] || '';
                if (errors[name]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
            });
        }

        function render() {
            var f = filters();
            var check = H.validateFilters(f);
            showFilterErrors(check.errors);
            if (!check.valid) {
                summary.textContent = 'Fix the dates to search.';
                return;
            }
            var now = Date.now();
            var parts = H.partitionByTime(H.filterEvents(events, f), now);

            listNode.textContent = '';
            parts.current.forEach(function (e) { listNode.appendChild(renderEvent(e, now)); });
            pastList.textContent = '';
            parts.past.forEach(function (e) { pastList.appendChild(renderEvent(e, now)); });

            past.hidden = parts.past.length === 0;
            pastCount.textContent = '(' + parts.past.length + ')';
            empty.hidden = parts.current.length !== 0;
            var unverified = parts.current.filter(function (e) { return !H.isConfirmed(e); }).length;
            summary.textContent = parts.current.length === 0
                ? 'No upcoming events found.'
                : parts.current.length + ' upcoming or ongoing event' + (parts.current.length === 1 ? '' : 's') +
                  (unverified ? ', ' + unverified + ' unverified' : '') + '.';
        }

        function clearFilters() {
            form.reset();
            render();
            el('filter-location').focus();
        }

        form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
        el('filter-unverified').addEventListener('change', render);
        el('filter-type').addEventListener('change', render);
        el('filter-clear').addEventListener('click', clearFilters);
        el('events-empty-clear').addEventListener('click', clearFilters);

        function loadSeed() {
            if (typeof fetch !== 'function') return Promise.resolve([]);
            return fetch(DATA_URL, { cache: 'no-cache' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                seedEvents = data && Array.isArray(data.events) ? data.events : [];
                return seedEvents;
            });
        }

        loadSeed()
            .then(function (seed) { return store.publicEvents(seed); }, function () { return store.publicEvents(null).then(function (r) { r.seedFailed = true; return r; }); })
            .then(function (result) {
                events = result.events;
                loading.hidden = true;
                listNode.setAttribute('aria-busy', 'false');
                if (result.seedFailed && events.length === 0) {
                    errorBox.textContent = 'Events could not be loaded. Check your connection and reload the page.';
                    errorBox.hidden = false;
                    summary.textContent = '';
                    return;
                }
                el('events-sample-note').hidden = !events.some(function (e) { return e.sample; });
                var options = el('filter-location-options');
                H.districts(events).forEach(function (name) {
                    var opt = document.createElement('option');
                    opt.value = name;
                    options.appendChild(opt);
                });
                render();
            });

        // Demo submissions appear immediately, but stay marked unverified.
        window.addEventListener('relief:health-event-submitted', function () {
            store.publicEvents(seedEvents).then(function (result) {
                events = result.events;
                render();
            });
        });
    }

    // Organiser form

    var SUBMIT_FIELDS = ['title', 'type', 'startDate', 'startTime', 'endDate', 'endTime', 'district', 'venue',
        'organiser', 'eligibility', 'services', 'contactPhone', 'contactEmail', 'sourceUrl'];

    function initSubmitForm() {
        var form = el('event-submit-form');
        if (!form) return;
        var status = el('event-submit-status');
        var button = form.querySelector('button[type="submit"]');
        var store = makeStore();
        if (isDemo()) el('event-submit-demo-note').hidden = false;

        function setStatus(message, tone) {
            status.textContent = message;
            status.dataset.tone = tone || '';
        }

        function clearErrors() {
            SUBMIT_FIELDS.forEach(function (name) {
                var err = el('event-error-' + name);
                if (err) err.textContent = '';
                var input = form.elements[name];
                if (input) input.removeAttribute('aria-invalid');
            });
        }

        function showErrors(errors) {
            var first = null;
            SUBMIT_FIELDS.forEach(function (name) {
                if (!errors[name]) return;
                var err = el('event-error-' + name);
                if (err) err.textContent = errors[name];
                var input = form.elements[name];
                if (input) {
                    input.setAttribute('aria-invalid', 'true');
                    if (!first) first = input;
                }
            });
            if (first) first.focus();
        }

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            clearErrors();
            var input = {};
            SUBMIT_FIELDS.concat(['website']).forEach(function (name) {
                input[name] = form.elements[name] ? form.elements[name].value : '';
            });
            button.disabled = true;
            setStatus('Sending…', '');
            store.submit(input).then(function (result) {
                button.disabled = false;
                if (!result.ok) {
                    showErrors(result.errors || {});
                    setStatus(result.message, 'error');
                    return;
                }
                form.reset();
                setStatus(result.demo
                    ? 'Saved in this browser for the demo review queue. It shows as "Unverified" until a moderator confirms it.'
                    : 'Thank you. Your event was sent for review. It will be listed as confirmed only after a moderator checks it.', 'success');
                window.dispatchEvent(new CustomEvent('relief:health-event-submitted'));
            });
        });
    }

    // Moderator queue

    function initModeration() {
        var section = el('event-moderation');
        if (!section) return;
        var queue = el('event-queue');
        var message = el('event-moderation-message');
        var filter = el('event-status-filter');
        var nameInput = el('event-moderator-name');
        var store = makeStore();

        if (isDemo()) el('event-moderation-demo-note').hidden = false;

        function setMessage(text, tone) {
            message.textContent = text;
            message.dataset.tone = tone || '';
        }

        function decisionForm(record) {
            var wrap = make('div', 'event-decision');
            var id = record.id.replace(/[^a-zA-Z0-9_-]/g, '');
            var evLabel = make('label', null, 'Evidence (needed to confirm): how you checked with the organiser');
            evLabel.htmlFor = 'evidence-' + id;
            var evidence = make('textarea');
            evidence.id = 'evidence-' + id;
            evidence.rows = 2;
            evidence.maxLength = 500;
            var reLabel = make('label', null, 'Reason (needed to reject)');
            reLabel.htmlFor = 'reason-' + id;
            var reason = make('textarea');
            reason.id = 'reason-' + id;
            reason.rows = 2;
            reason.maxLength = 500;
            var errors = make('p', 'field-error');
            errors.setAttribute('role', 'alert');
            var approve = make('button', 'btn btn-primary', 'Confirm event');
            approve.type = 'button';
            var reject = make('button', 'btn btn-danger', 'Reject');
            reject.type = 'button';

            function send(kind) {
                errors.textContent = '';
                approve.disabled = reject.disabled = true;
                store.review(record.id, { decision: kind, actor: nameInput.value, evidence: evidence.value, reason: reason.value }).then(function (result) {
                    approve.disabled = reject.disabled = false;
                    if (!result.ok) {
                        var e = result.errors || {};
                        errors.textContent = [e.actor, e.evidence, e.reason, e.decision].filter(Boolean).join(' ') || result.message;
                        return;
                    }
                    setMessage('"' + record.title + '" was ' + (kind === 'approve' ? 'confirmed' : 'rejected') + '.', 'success');
                    refresh();
                });
            }
            approve.addEventListener('click', function () { send('approve'); });
            reject.addEventListener('click', function () { send('reject'); });
            [evLabel, evidence, reLabel, reason, errors].forEach(function (n) { wrap.appendChild(n); });
            var actions = make('div', 'event-decision-actions');
            actions.appendChild(approve);
            actions.appendChild(reject);
            wrap.appendChild(actions);
            return wrap;
        }

        function renderItem(record) {
            var event = H.normalizeEvent(record);
            var item = make('article', 'event-card');
            if (!event) {
                item.appendChild(make('p', null, 'A submission with invalid dates or missing fields (' + String(record.id || 'no id') + ').'));
                return item;
            }
            var badges = make('p', 'event-badges');
            var label = record.status === 'pending' ? 'Waiting for review' : record.status === 'confirmed' ? 'Confirmed' : 'Rejected';
            badges.appendChild(make('span', 'event-badge event-badge--' + (record.status === 'confirmed' ? 'confirmed' : 'unverified'), label));
            badges.appendChild(make('span', 'event-badge event-badge--type', H.TYPES[event.type]));
            item.appendChild(badges);
            item.appendChild(make('h3', 'event-title', event.title));
            var list = make('dl', 'event-details');
            detail(list, 'When', describeWhen(event));
            detail(list, 'Where', [event.venue, event.district].filter(Boolean).join(', '));
            detail(list, 'Organiser', event.organiser);
            detail(list, 'Services', event.services.join(', '));
            detail(list, 'Who can attend', event.eligibility);
            detail(list, 'Contact', [event.contactPhone, event.contactEmail].filter(Boolean).join(' · '));
            var href = safeHref(event.sourceUrl);
            if (href) {
                var link = make('a', null, href);
                link.href = href;
                link.rel = 'noopener noreferrer nofollow';
                link.target = '_blank';
                detail(list, 'Source', link);
            }
            detail(list, 'Submitted', formatStamp(record.createdAt));
            if (record.status !== 'pending') {
                detail(list, 'Decided', formatStamp(record.decidedAt) + (record.verifiedBy ? ' by ' + record.verifiedBy : ''));
                detail(list, record.status === 'confirmed' ? 'Evidence' : 'Reason', record.status === 'confirmed' ? record.evidence : record.decisionReason);
            }
            item.appendChild(list);
            if (record.status === 'pending') {
                if (H.timeState(event, Date.now()) === 'past') {
                    item.appendChild(make('p', 'event-warning', 'This event has already ended. Reject it as out of date.'));
                }
                item.appendChild(decisionForm(record));
            }
            return item;
        }

        function refresh() {
            queue.textContent = '';
            queue.appendChild(make('p', 'muted', 'Loading submissions…'));
            store.list({ status: filter.value }).then(function (result) {
                queue.textContent = '';
                if (!result.ok) {
                    el('event-moderation-controls').hidden = result.kind === 'unauthenticated' || result.kind === 'forbidden';
                    setMessage(result.message, 'error');
                    return;
                }
                el('event-moderation-controls').hidden = false;
                if (!result.items.length) {
                    queue.appendChild(make('p', 'muted', 'Nothing to show for this filter.'));
                    return;
                }
                result.items.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
                    .forEach(function (r) { queue.appendChild(renderItem(r)); });
            });
        }

        filter.addEventListener('change', refresh);
        el('event-refresh').addEventListener('click', refresh);
        refresh();
    }

    function init() {
        initList();
        initSubmitForm();
        initModeration();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
