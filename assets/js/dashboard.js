document.addEventListener('DOMContentLoaded', () => {
    const R = window.ReliefReminders;
    const form = document.getElementById('reminder-form');
    const list = document.getElementById('reminder-list');
    const timeline = document.getElementById('timeline');
    const kpiReminders = document.getElementById('kpi-reminders');
    const banner = document.getElementById('reminder-banner');
    const bannerMessages = document.getElementById('reminder-banner-messages');
    const submitBtn = document.getElementById('reminder-submit');
    const cancelBtn = document.getElementById('reminder-cancel');
    const NP = window.ReliefNotificationPrefs;
    const notifyStatus = document.getElementById('notify-status');
    const notifyExplain = document.getElementById('notify-explain');
    const notifyBtn = document.getElementById('notify-enable');
    const notifyOffBtn = document.getElementById('notify-disable');
    const notifyDetails = document.getElementById('notify-details');
    const notifyDetailsWrap = document.getElementById('notify-details-wrap');
    const fields = {
        id: document.getElementById('reminder-id'),
        medicine: document.getElementById('medicine'),
        instructions: document.getElementById('instructions'),
        time: document.getElementById('time'),
        startDate: document.getElementById('start-date'),
        endDate: document.getElementById('end-date'),
        modeLocal: document.getElementById('schedule-local'),
        modeFixed: document.getElementById('schedule-fixed'),
        zone: document.getElementById('schedule-zone'),
        zoneWrap: document.getElementById('schedule-zone-wrap')
    };
    const explainEl = document.getElementById('schedule-explain');
    const savedEl = document.getElementById('reminder-saved');

    const historyKey = 'relief_history_v1';
    const timeZone = R ? R.getLocalTimeZone() : 'UTC';

    let reminders = R ? R.loadReminders(localStorage) : [];
    // Set after "Delete my account and data" so the page does not write its old state back.
    let dataDeleted = false;
    const history = JSON.parse(localStorage.getItem(historyKey) || '[{"date":"2026-01-02","event":"Symptom check completed","status":"Advised doctor consult"},{"date":"2026-01-04","event":"Appointment booked","status":"Dr. A. Sen - 10:30 AM"}]');

    const esc = (v) => (R ? R.escapeHtml(v) : String(v));

    function logHistory(event, status) {
        history.unshift({ date: new Date().toISOString().slice(0, 10), event, status });
    }

    // Field settings for the shared error helper (see form-errors.js).
    const ERROR_FIELDS = {
        medicine: { focusId: 'medicine', errorId: 'medicine-error' },
        instructions: { focusId: 'instructions', errorId: 'instructions-error' },
        time: { focusId: 'time', errorId: 'time-error' },
        startDate: { focusId: 'start-date', errorId: 'start-date-error' },
        endDate: { focusId: 'end-date', errorId: 'end-date-error' },
        scheduleMode: { focusId: 'schedule-local', groupId: 'schedule-group' },
        scheduleTimeZone: { focusId: 'schedule-zone', errorId: 'schedule-zone-error' }
    };
    const ERROR_ORDER = ['medicine', 'instructions', 'time', 'startDate', 'endDate', 'scheduleMode', 'scheduleTimeZone'];
    const FE = window.ReliefFormErrors;

    // Inline message per field, aria-invalid, and a summary. Focus goes to the summary when
    // several things need fixing, or to the field when there is only one. What the user typed stays.
    function showErrors(errors) {
        const messages = errors || {};
        if (Object.keys(messages).length === 0) {
            FE.clearErrors(document, { fields: ERROR_FIELDS, summaryId: 'reminder-error-summary' });
            return;
        }
        FE.applyErrors(document, messages, {
            fields: ERROR_FIELDS,
            order: ERROR_ORDER,
            summaryId: 'reminder-error-summary',
            title: 'Please fix the following'
        });
    }

    FE.bindSummaryLinks(document, 'reminder-error-summary');

    function persist() {
        if (dataDeleted) return;
        const saved = R.saveReminders(localStorage, reminders);
        localStorage.setItem(historyKey, JSON.stringify(history));
        if (!saved) showErrors({ form: 'Could not save reminders in this browser (storage may be full or blocked).' });
    }

    const STATE_LABELS = { active: 'Active', paused: 'Paused', completed: 'Completed', upcoming: 'Starts later', expired: 'Ended' };

    function renderItem(r, now) {
        const state = R.getReminderState(r, now, timeZone);
        const range = [r.startDate ? `From ${r.startDate}` : '', r.endDate ? `until ${r.endDate}` : ''].filter(Boolean).join(' ');
        const tzWarn = R.getTimeZoneWarning(r, timeZone);
        const id = esc(r.id);
        const actions = state === 'completed'
            ? `<button type="button" class="btn" data-action="remove" data-id="${id}">Remove</button>`
            : `<button type="button" class="btn" data-action="edit" data-id="${id}">Edit</button>
               <button type="button" class="btn" data-action="${r.status === 'paused' ? 'resume' : 'pause'}" data-id="${id}">${r.status === 'paused' ? 'Resume' : 'Pause'}</button>
               <button type="button" class="btn" data-action="done" data-id="${id}">Done</button>`;
        return `
            <li class="reminder-item reminder-${state}">
                <div>
                    <strong>${esc(r.medicine)}</strong> <span class="pill">${STATE_LABELS[state]}</span>
                    <div class="muted">${esc(scheduleLabel(r))}</div>
                    ${r.instructions ? `<div class="muted">${esc(r.instructions)}</div>` : ''}
                    ${range ? `<div class="muted">${esc(range)}</div>` : ''}
                    ${tzWarn ? `<div class="muted">${esc(tzWarn)}</div>` : ''}
                </div>
                <div class="reminder-actions">${actions}</div>
            </li>`;
    }

    function scheduleLabel(r) {
        return r.scheduleMode === 'fixed'
            ? `Daily at ${r.time} in ${r.timeZone}`
            : `Daily at ${r.time} on this device's clock`;
    }

    function render() {
        const now = new Date();
        list.innerHTML = reminders.length
            ? reminders.map((r) => renderItem(r, now)).join('')
            : '<li class="muted">No reminders yet.</li>';

        timeline.innerHTML = history.map(h => `<tr><td>${esc(h.date)}</td><td>${esc(h.event)}</td><td>${esc(h.status)}</td></tr>`).join('');

        if (kpiReminders) {
            kpiReminders.textContent = R.countActive(reminders, now, timeZone);
        }

        persist();
    }

    function resetForm() {
        form.reset();
        fields.id.value = '';
        syncScheduleMode();
        submitBtn.textContent = 'Save Reminder';
        cancelBtn.hidden = true;
        showErrors({});
    }

    function readForm() {
        return {
            medicine: fields.medicine.value,
            instructions: fields.instructions.value,
            time: fields.time.value,
            startDate: fields.startDate.value,
            endDate: fields.endDate.value,
            scheduleMode: fields.modeFixed.checked ? 'fixed' : 'local',
            scheduleTimeZone: fields.modeFixed.checked ? fields.zone.value : ''
        };
    }

    // ---- schedule: which clock, and a plain explanation before saving ----

    function populateZones() {
        let zones = [];
        try {
            zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
        } catch (e) { zones = []; }
        if (!zones.length) zones = ['Asia/Kolkata', 'Asia/Dhaka', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];
        if (zones.indexOf(timeZone) === -1) zones = [timeZone].concat(zones);
        fields.zone.innerHTML = '';
        zones.forEach((z) => {
            const option = document.createElement('option');
            option.value = z;
            option.textContent = z;
            fields.zone.appendChild(option);
        });
        fields.zone.value = timeZone;
    }

    function updateExplanation() {
        explainEl.textContent = R.explainSchedule(readForm(), new Date(), timeZone);
    }

    function syncScheduleMode() {
        fields.zoneWrap.hidden = !fields.modeFixed.checked;
        if (!fields.modeFixed.checked) fields.zone.value = timeZone;
        updateExplanation();
    }

    ['input', 'change'].forEach((name) => {
        fields.time.addEventListener(name, updateExplanation);
        fields.startDate.addEventListener(name, updateExplanation);
        fields.zone.addEventListener(name, updateExplanation);
    });
    [fields.modeLocal, fields.modeFixed].forEach((radio) => radio.addEventListener('change', syncScheduleMode));
    populateZones();
    syncScheduleMode();

    // Due reminders always show in the in-app banner. A browser notification is added only when the
    // user turned it on here AND the browser allows it, and it says only "a reminder is due" unless
    // they chose to show medicine names (see notification-prefs.js).
    function checkDue() {
        const now = new Date();
        const due = R.getDueReminders(reminders, now, timeZone);
        if (!due.length) return;

        const result = NP.deliver(due, window.Notification, NP.loadPrefs(localStorage));
        result.inApp.forEach((message) => {
            const line = document.createElement('p');
            line.textContent = message;
            bannerMessages.appendChild(line);
        });
        due.forEach((r) => {
            const date = R.getLocalParts(now, R.getEffectiveTimeZone(r, timeZone)).date;
            reminders = R.markNotified(reminders, r.id, date, now.getTime());
        });
        banner.hidden = false;
        persist();
    }

    // Shows what will actually happen: the user's choice combined with the browser's permission.
    function renderNotifyPanel() {
        const prefs = NP.loadPrefs(localStorage);
        const permission = NP.getPermission(window.Notification);
        const plan = NP.getPlan(prefs, permission);

        notifyExplain.textContent = NP.EXPLANATION;
        notifyStatus.textContent = plan.message;

        // Offer "turn on" unless the browser cannot or will not show them.
        notifyBtn.hidden = !(plan.state === 'off' || plan.state === 'needs-permission') || permission === 'denied';
        notifyBtn.textContent = plan.state === 'needs-permission' ? 'Ask my browser for permission' : 'Turn on browser notifications';
        notifyOffBtn.hidden = !(plan.state === 'active' || plan.state === 'blocked' || plan.state === 'needs-permission');

        notifyDetailsWrap.hidden = plan.state === 'unsupported';
        document.getElementById('notify-details-label').textContent = NP.DETAILS_WARNING;
        notifyDetails.checked = prefs.showDetails;
    }

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        dataDeleted = false;
        const editId = fields.id.value;
        const ctx = { timeZone };
        const result = editId
            ? R.editReminder(reminders, editId, readForm(), ctx)
            : R.addReminder(reminders, readForm(), ctx);

        if (!result.ok) {
            showErrors(result.errors);
            return;
        }

        reminders = result.reminders;
        const r = result.reminder;
        logHistory(editId ? 'Medication reminder updated' : 'Medication reminder created', `${r.medicine} at ${r.time}`);
        const firstLine = R.explainSchedule({ ...readForm(), scheduleMode: r.scheduleMode, scheduleTimeZone: r.scheduleMode === 'fixed' ? r.timeZone : '' }, new Date(), timeZone).split('First reminder:')[1];
        resetForm();
        render();
        checkDue();
        savedEl.textContent = `Reminder saved.${firstLine ? ' First reminder:' + firstLine : ''}`;
        savedEl.hidden = false;
    });

    cancelBtn?.addEventListener('click', resetForm);

    document.addEventListener('relief:data-deleted', (e) => {
        if (!e.detail || (e.detail.local && e.detail.local.state === 'unavailable')) return;
        dataDeleted = true;
        reminders = [];
        history.length = 0;
        bannerMessages.innerHTML = '';
        banner.hidden = true;
        resetForm();
        render();
    });

    notifyBtn?.addEventListener('click', () => {
        NP.enableBrowserNotifications(window.Notification, localStorage).then(renderNotifyPanel, renderNotifyPanel);
    });

    notifyOffBtn?.addEventListener('click', () => {
        NP.disableBrowserNotifications(window.Notification, localStorage);
        renderNotifyPanel();
    });

    notifyDetails?.addEventListener('change', () => {
        NP.setShowDetails(window.Notification, localStorage, notifyDetails.checked);
        renderNotifyPanel();
    });

    banner?.addEventListener('click', (e) => {
        if (e.target.closest('button[data-dismiss]')) {
            bannerMessages.innerHTML = '';
            banner.hidden = true;
        }
    });

    list?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        dataDeleted = false;
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        const current = reminders.find((r) => r.id === id);
        if (!current) return;

        if (action === 'edit') {
            fields.id.value = current.id;
            fields.medicine.value = current.medicine;
            fields.instructions.value = current.instructions;
            fields.time.value = current.time;
            fields.startDate.value = current.startDate;
            fields.endDate.value = current.endDate;
            fields.modeFixed.checked = current.scheduleMode === 'fixed';
            fields.modeLocal.checked = current.scheduleMode !== 'fixed';
            if (current.scheduleMode === 'fixed') fields.zone.value = current.timeZone;
            syncScheduleMode();
            submitBtn.textContent = 'Update Reminder';
            cancelBtn.hidden = false;
            showErrors({});
            fields.medicine.focus();
            return;
        }

        let result;
        if (action === 'pause' || action === 'resume') {
            result = R.setPaused(reminders, id, action === 'pause');
            if (result.ok) logHistory(action === 'pause' ? 'Reminder paused' : 'Reminder resumed', current.medicine);
        } else if (action === 'done') {
            result = R.completeReminder(reminders, id);
            if (result.ok) logHistory('Reminder marked done', current.medicine);
        } else if (action === 'remove') {
            result = R.removeReminder(reminders, id);
            if (result.ok) logHistory('Reminder removed', current.medicine);
        }

        if (result && result.ok) {
            reminders = result.reminders;
            if (fields.id.value === id) resetForm();
            render();
        } else if (result) {
            showErrors(result.errors);
        }
    });

    if (form && R) {
        document.getElementById('reminder-disclaimer').textContent = R.REMINDER_DISCLAIMER;
        document.getElementById('reminder-persistence').textContent = `${R.PERSISTENCE_NOTE} ${R.TIMEZONE_NOTE}`;
        renderNotifyPanel();
        setInterval(checkDue, 30000);
    }

    initializeChatbot();
    if (form && R) {
        render();
        checkDue();
    }
});

function initializeChatbot() {
    const form = document.getElementById('chatbot-form');
    const input = document.getElementById('chatbot-input');
    const messages = document.getElementById('chatbot-messages');
    const chips = document.querySelectorAll('.chip[data-chat]');
    const clearBtn = document.getElementById('chatbot-clear');

    if (!form || !input || !messages) return;

    function appendBubble(sender, text, options) {
        const opts = options || {};
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ' + sender + (opts.alert ? ' urgent' : '');
        if (opts.alert) bubble.setAttribute('role', 'alert');
        const p = document.createElement('p');
        p.textContent = text;
        bubble.appendChild(p);
        (opts.links || []).forEach(function (link) {
            const a = document.createElement('a');
            a.href = link.href;
            a.textContent = link.label;
            a.className = 'chat-link';
            bubble.appendChild(a);
        });
        if (opts.retry) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chip';
            btn.textContent = 'Retry';
            btn.addEventListener('click', function () {
                bubble.remove();
                send(opts.retry);
            });
            bubble.appendChild(btn);
        }
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
    }

    function send(text) {
        const assistant = window.ReliefAssistant;
        const result = assistant
            ? assistant.safeRoute(text)
            : { text: 'The assistant could not load. Please reload the page. If this is an emergency, call local emergency services now.', links: [] };
        appendBubble('bot', result.text, {
            alert: result.alert,
            links: result.links,
            retry: result.retry ? text : null
        });
    }

    function ask(text) {
        appendBubble('user', text);
        send(text);
    }

    function greet() {
        appendBubble('bot', 'Hi, I’m Relief Assistant. I can point you to doctors, hospitals, first aid and plans. I can’t give medical advice.');
    }

    greet();

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        ask(text);
        input.value = '';
    });

    chips.forEach(chip => {
        chip.addEventListener('click', () => ask(chip.dataset.chat));
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            messages.textContent = '';
            greet();
            input.focus();
        });
    }
}
