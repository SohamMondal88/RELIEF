/**
 * Page wiring for facility corrections.
 *   - pages/hospitals.html: the "Suggest a correction" form (#correction-form)
 *   - pages/admin-panel.html: the moderator queue (#correction-moderation)
 * The rules live in facility-corrections.js. This file only reads the form,
 * shows the answer and builds the moderator list with textContent (nothing a
 * visitor typed is ever put into the page as HTML).
 */
(function () {
    'use strict';

    var C = window.FacilityCorrections;
    if (!C) return;

    var FIELD_HINTS = {
        hours: 'For example: Mon to Sat 9:00 to 17:00, emergency open 24 hours',
        phone: 'For example: +91 33 1234 5678',
        address: 'Street, area, town and PIN code',
        services: 'Separate several with commas, for example: Emergency Care, Pediatrics'
    };

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

    // Demo mode: localhost, file:// or an explicit flag (same rule as the sign-in fallback).
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

    function makeStore(facilities) {
        return C.createStore({
            api: window.ReliefAPI || null,
            storage: safeStorage(),
            demo: isDemo(),
            facilities: facilities || []
        });
    }

    function showValue(value) {
        if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not listed';
        return value ? String(value) : 'Not listed';
    }

    function formatTime(iso) {
        var t = Date.parse(iso);
        return isFinite(t) ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    }

    // Only http(s) links are ever made clickable, whatever the stored record says.
    function safeHref(url) {
        try {
            var parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
        } catch (e) {
            return null;
        }
    }

    // ---- public form ----------------------------------------------------

    function initForm() {
        var form = el('correction-form');
        if (!form) return;

        var section = el('correction-section');
        var facilitySelect = el('correction-facility');
        var fieldSelect = el('correction-field');
        var valueInput = el('correction-value');
        var currentNote = el('correction-current');
        var statusBox = el('correction-status');
        var demoNote = el('correction-demo-note');
        var submitButton = form.querySelector('button[type="submit"]');
        var facilities = [];

        function facilityById(id) {
            for (var i = 0; i < facilities.length; i++) { if (facilities[i].id === id) return facilities[i]; }
            return null;
        }

        function updateHints() {
            var field = fieldSelect.value;
            valueInput.placeholder = FIELD_HINTS[field] || '';
            var hint = el('correction-value-hint');
            if (hint) hint.textContent = FIELD_HINTS[field] || 'Choose what to correct first.';
            var facility = facilityById(facilitySelect.value);
            if (facility && field) {
                currentNote.textContent = 'Currently listed: ' + showValue(facility[field]);
            } else {
                currentNote.textContent = '';
            }
        }

        function clearErrors() {
            ['facility', 'field', 'value', 'source', 'contact'].forEach(function (name) {
                var err = el('correction-error-' + name);
                if (err) err.textContent = '';
            });
            [facilitySelect, fieldSelect, valueInput, el('correction-source'), el('correction-contact')].forEach(function (input) {
                if (input) input.removeAttribute('aria-invalid');
            });
        }

        function showErrors(errors) {
            var map = {
                facilityId: ['facility', facilitySelect],
                field: ['field', fieldSelect],
                proposedValue: ['value', valueInput],
                sourceUrl: ['source', el('correction-source')],
                contact: ['contact', el('correction-contact')]
            };
            var first = null;
            Object.keys(map).forEach(function (key) {
                if (!errors[key]) return;
                var target = el('correction-error-' + map[key][0]);
                if (target) target.textContent = errors[key];
                if (map[key][1]) {
                    map[key][1].setAttribute('aria-invalid', 'true');
                    if (!first) first = map[key][1];
                }
            });
            if (first) first.focus();
        }

        function setStatus(message, tone) {
            statusBox.textContent = message;
            statusBox.dataset.tone = tone || '';
        }

        function populate(list) {
            facilities = list || [];
            facilitySelect.innerHTML = '';
            var first = make('option', null, 'Choose a facility');
            first.value = '';
            facilitySelect.appendChild(first);
            facilities.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
                var option = make('option', null, f.name + (f.district ? ' (' + f.district + ')' : ''));
                option.value = f.id;
                facilitySelect.appendChild(option);
            });
            if (demoNote) {
                var demo = isDemo();
                demoNote.hidden = !demo;
            }
            section.hidden = false;
        }

        document.addEventListener('relief:facilities-loaded', function (event) {
            populate(event.detail && event.detail.facilities);
        });

        // "Suggest a correction" button on a facility card
        document.addEventListener('click', function (event) {
            var button = event.target.closest ? event.target.closest('.btn-correct') : null;
            if (!button || section.hidden) return;
            facilitySelect.value = button.getAttribute('data-id') || '';
            updateHints();
            section.scrollIntoView({ block: 'start' });
            fieldSelect.focus();
        });

        facilitySelect.addEventListener('change', updateHints);
        fieldSelect.addEventListener('change', updateHints);

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            clearErrors();
            setStatus('');
            submitButton.disabled = true;
            var store = makeStore(facilities);
            store.submit({
                facilityId: facilitySelect.value,
                field: fieldSelect.value,
                proposedValue: valueInput.value,
                sourceUrl: el('correction-source').value,
                contact: el('correction-contact').value,
                website: el('correction-website').value
            }).then(function (result) {
                if (result.ok) {
                    form.reset();
                    updateHints();
                    setStatus(result.demo
                        ? 'Demo mode: your suggestion was saved only in this browser, for trying out the moderator page. It was not sent to anyone. The directory has not changed.'
                        : 'Thank you. Your suggestion is waiting for a moderator to check it. The directory has not changed.', 'ok');
                    return;
                }
                if (result.kind === 'invalid') showErrors(result.errors || {});
                setStatus(result.message, result.kind === 'duplicate' ? 'info' : 'error');
            }).then(function () {
                submitButton.disabled = false;
            }, function () {
                setStatus('Something went wrong. Please try again.', 'error');
                submitButton.disabled = false;
            });
        });
    }

    // ---- moderator view -------------------------------------------------

    function initModeration() {
        var root = el('correction-moderation');
        if (!root) return;

        var queueBox = el('correction-queue');
        var logBox = el('correction-log');
        var patchBox = el('correction-patch');
        var statusFilter = el('correction-status-filter');
        var moderatorInput = el('moderator-name');
        var message = el('moderation-message');
        var demoNote = el('moderation-demo-note');
        var controls = el('moderation-controls');
        var store = makeStore([]);

        function setMessage(text, tone) {
            message.textContent = text;
            message.dataset.tone = tone || '';
        }

        function detailRow(label, value) {
            var row = make('p', 'correction-detail');
            row.appendChild(make('strong', null, label + ': '));
            row.appendChild(document.createTextNode(value));
            return row;
        }

        function renderItem(item) {
            var card = make('article', 'correction-item');
            card.setAttribute('data-id', item.id);
            var head = make('h3', 'correction-title', item.facilityName || item.facilityId);
            card.appendChild(head);
            var badges = make('p', 'correction-badges');
            badges.appendChild(make('span', 'correction-badge correction-badge--' + item.status, item.status));
            if (item.demo) badges.appendChild(make('span', 'correction-badge correction-badge--demo', 'demo'));
            card.appendChild(badges);

            var spec = C.FIELDS[item.field];
            card.appendChild(detailRow('Field', spec ? spec.label : String(item.field)));
            card.appendChild(detailRow('Listed now', showValue(item.currentValue)));
            card.appendChild(detailRow('Suggested', showValue(item.proposedValue)));
            card.appendChild(detailRow('Sent', formatTime(item.createdAt)));

            if (item.sourceUrl) {
                var href = safeHref(item.sourceUrl);
                var row = make('p', 'correction-detail');
                row.appendChild(make('strong', null, 'Source link: '));
                if (href) {
                    var link = make('a', null, href);
                    link.href = href;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    row.appendChild(link);
                } else {
                    row.appendChild(document.createTextNode('(not a valid web address)'));
                }
                card.appendChild(row);
            } else {
                card.appendChild(detailRow('Source link', 'none given'));
            }

            if (item.status === 'pending') {
                if (item.contact) card.appendChild(detailRow('Contact (removed when decided)', item.contact));
                var evidenceId = 'evidence-' + item.id;
                var reasonId = 'reason-' + item.id;
                var evLabel = make('label', null, 'Evidence you checked (needed to approve)');
                evLabel.setAttribute('for', evidenceId);
                var evidence = make('input');
                evidence.id = evidenceId;
                evidence.type = 'text';
                evidence.maxLength = 500;
                evidence.placeholder = 'e.g. Called the front desk on 24 Oct; matches hospital website';
                var reLabel = make('label', null, 'Reason (needed to reject)');
                reLabel.setAttribute('for', reasonId);
                var reason = make('input');
                reason.id = reasonId;
                reason.type = 'text';
                reason.maxLength = 500;
                reason.placeholder = 'e.g. Could not confirm; source is a forum post';
                var actions = make('div', 'correction-actions');
                var approve = make('button', 'btn btn-primary', 'Approve');
                approve.type = 'button';
                var reject = make('button', 'btn btn-danger', 'Reject');
                reject.type = 'button';
                var error = make('p', 'correction-error');
                error.setAttribute('role', 'alert');
                function decide(kind) {
                    error.textContent = '';
                    store.review(item.id, {
                        decision: kind,
                        actor: moderatorInput.value,
                        evidence: evidence.value,
                        reason: reason.value
                    }).then(function (result) {
                        if (result.ok) {
                            setMessage('Correction ' + (kind === 'approve' ? 'approved' : 'rejected') + '. The public directory has not changed: approved changes are applied by a maintainer.', 'ok');
                            load();
                            return;
                        }
                        var errs = result.errors || {};
                        error.textContent = errs.actor || errs.evidence || errs.reason || errs.decision || errs.form || result.message;
                    });
                }
                approve.addEventListener('click', function () { decide('approve'); });
                reject.addEventListener('click', function () { decide('reject'); });
                actions.appendChild(approve);
                actions.appendChild(reject);
                [evLabel, evidence, reLabel, reason, actions, error].forEach(function (node) { card.appendChild(node); });
            } else {
                card.appendChild(detailRow('Decided by', (item.decidedBy || 'unknown') + (item.decidedAt ? ' on ' + formatTime(item.decidedAt) : '')));
                if (item.evidence) card.appendChild(detailRow('Evidence', item.evidence));
                if (item.decisionReason) card.appendChild(detailRow('Reason', item.decisionReason));
            }
            return card;
        }

        function renderLog(all) {
            logBox.textContent = '';
            var rows = C.decisionLog(all);
            if (!rows.length) {
                logBox.appendChild(make('li', 'correction-empty', 'Nothing logged yet.'));
                return;
            }
            rows.forEach(function (row) {
                var item = make('li', 'correction-log-item');
                var text = formatTime(row.at) + ': ' + row.action + ' by ' + row.by + ' (' + (row.facilityName || row.facilityId) + ', ' + row.field + ')';
                if (row.note) text += '. Reason: ' + row.note;
                if (row.evidence) text += '. Evidence: ' + row.evidence;
                item.textContent = text;
                logBox.appendChild(item);
            });
        }

        function load() {
            store.list({ status: 'all' }).then(function (result) {
                queueBox.textContent = '';
                if (!result.ok) {
                    controls.hidden = true;
                    queueBox.appendChild(make('p', 'correction-empty', result.message));
                    renderLog([]);
                    patchBox.textContent = '[]';
                    return;
                }
                controls.hidden = false;
                demoNote.hidden = !result.demo;
                var filter = statusFilter.value;
                var shown = result.items.filter(function (r) { return filter === 'all' || r.status === filter; });
                shown.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
                if (!shown.length) {
                    queueBox.appendChild(make('p', 'correction-empty', filter === 'pending' ? 'No corrections waiting for review.' : 'No corrections with this status.'));
                } else {
                    shown.forEach(function (item) { queueBox.appendChild(renderItem(item)); });
                }
                renderLog(result.items);
                patchBox.textContent = JSON.stringify(C.approvedPatch(result.items), null, 2);
            });
        }

        statusFilter.addEventListener('change', load);
        el('correction-refresh').addEventListener('click', load);
        load();
    }

    function init() {
        initForm();
        initModeration();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
