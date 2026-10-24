/**
 * Medicine reminder logic (Issue #19).
 *
 * Pure functions only: no DOM access, so they can be tested with node:test
 * (see tests/reminders.test.js). The dashboard UI in dashboard.js calls these.
 *
 * This is a reminder tool. It does not recommend medicines, doses or schedules.
 * Everything is saved in this browser's localStorage only.
 */

(function () {
    'use strict';

    const REMINDERS_KEY = 'relief_reminders_v1';
    const STATUSES = ['active', 'paused', 'completed'];
    const MAX_NAME_LENGTH = 80;
    const MAX_INSTRUCTIONS_LENGTH = 300;

    const REMINDER_DISCLAIMER = 'These reminders only repeat what you type in. RELIEF does not suggest medicines, doses or schedules, so follow your doctor or pharmacist for that.';
    const PERSISTENCE_NOTE = 'Reminders are saved only in this browser on this device. Clearing site data or switching browser or device removes them, and nothing is synced to an account.';
    const TIMEZONE_NOTE = 'Times are the clock time on this device. Reminders only fire while this dashboard is open in a tab, and if your device time zone changes they follow the new local clock time.';

    // ---------- date and time helpers ----------

    function getLocalTimeZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch (e) {
            return 'UTC';
        }
    }

    /** Returns { date: 'YYYY-MM-DD', time: 'HH:MM' } for an instant in the given IANA time zone. */
    function getLocalParts(now, timeZone) {
        const tz = timeZone || getLocalTimeZone();
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(now);
        const get = (type) => parts.find((p) => p.type === type).value;
        return {
            date: `${get('year')}-${get('month')}-${get('day')}`,
            time: `${get('hour')}:${get('minute')}`
        };
    }

    function isValidTime(value) {
        return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    }

    /** True only for real calendar dates in YYYY-MM-DD form (so 2026-02-30 is rejected). */
    function isValidDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [y, m, d] = value.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }

    function normalizeName(name) {
        return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------- storage ----------

    /** Turns a stored entry into the current shape. Old entries were only { medicine, time }. */
    function normalizeReminder(raw, index) {
        if (!raw || typeof raw !== 'object') return null;
        const medicine = String(raw.medicine || '').trim();
        if (!medicine || !isValidTime(raw.time)) return null;
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : `legacy-${index}`,
            medicine,
            instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
            time: raw.time,
            startDate: isValidDate(raw.startDate) ? raw.startDate : '',
            endDate: isValidDate(raw.endDate) ? raw.endDate : '',
            status: STATUSES.includes(raw.status) ? raw.status : 'active',
            timeZone: typeof raw.timeZone === 'string' ? raw.timeZone : '',
            lastNotifiedOn: isValidDate(raw.lastNotifiedOn) ? raw.lastNotifiedOn : ''
        };
    }

    function loadReminders(storage) {
        try {
            const parsed = JSON.parse(storage.getItem(REMINDERS_KEY) || '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed.map(normalizeReminder).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    /** Returns true if saved, false if the browser refused (private mode, quota). */
    function saveReminders(storage, reminders) {
        try {
            storage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
            return true;
        } catch (e) {
            return false;
        }
    }

    // ---------- validation and duplicates ----------

    /**
     * Checks form input. Returns { valid, errors, value }.
     * startDate / endDate are optional; blank means "from now" and "no end".
     */
    function validateReminderInput(input, ctx) {
        const context = ctx || {};
        const today = context.today || getLocalParts(context.now || new Date(), context.timeZone).date;
        const src = input || {};
        const errors = {};

        const medicine = String(src.medicine || '').trim().replace(/\s+/g, ' ');
        const instructions = String(src.instructions || '').trim();
        const time = String(src.time || '').trim();
        const startDate = String(src.startDate || '').trim();
        const endDate = String(src.endDate || '').trim();

        if (!medicine) errors.medicine = 'Enter a medicine name or label.';
        else if (medicine.length > MAX_NAME_LENGTH) errors.medicine = `Keep the name under ${MAX_NAME_LENGTH} characters.`;

        if (instructions.length > MAX_INSTRUCTIONS_LENGTH) errors.instructions = `Keep the note under ${MAX_INSTRUCTIONS_LENGTH} characters.`;

        if (!time) errors.time = 'Pick a time.';
        else if (!isValidTime(time)) errors.time = 'Enter a valid time (HH:MM).';

        if (startDate && !isValidDate(startDate)) errors.startDate = 'Enter a valid start date.';
        if (endDate && !isValidDate(endDate)) errors.endDate = 'Enter a valid end date.';

        if (!errors.startDate && !errors.endDate && endDate) {
            if (startDate && endDate < startDate) errors.endDate = 'End date cannot be before the start date.';
            else if (endDate < today) errors.endDate = 'End date has already passed.';
        }

        return {
            valid: Object.keys(errors).length === 0,
            errors,
            value: { medicine, instructions, time, startDate, endDate }
        };
    }

    /** A duplicate is the same medicine name (ignoring case/spaces) at the same time, ignoring completed ones. */
    function findDuplicate(reminders, candidate, excludeId) {
        const name = normalizeName(candidate.medicine);
        return reminders.find((r) =>
            r.id !== excludeId &&
            r.status !== 'completed' &&
            normalizeName(r.medicine) === name &&
            r.time === candidate.time
        ) || null;
    }

    // ---------- create / edit / pause / complete ----------

    function makeId(ctx) {
        const context = ctx || {};
        if (typeof context.idFn === 'function') return context.idFn();
        return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    }

    function failure(reminders, errors) {
        return { ok: false, errors, reminders, reminder: null };
    }

    function addReminder(reminders, input, ctx) {
        const check = validateReminderInput(input, ctx);
        if (!check.valid) return failure(reminders, check.errors);
        if (findDuplicate(reminders, check.value)) {
            return failure(reminders, { form: `You already have a reminder for ${check.value.medicine} at ${check.value.time}.` });
        }
        const reminder = {
            id: makeId(ctx),
            ...check.value,
            status: 'active',
            timeZone: (ctx && ctx.timeZone) || getLocalTimeZone(),
            lastNotifiedOn: ''
        };
        return { ok: true, errors: {}, reminders: [...reminders, reminder], reminder };
    }

    function editReminder(reminders, id, input, ctx) {
        const existing = reminders.find((r) => r.id === id);
        if (!existing) return failure(reminders, { form: 'That reminder no longer exists.' });
        if (existing.status === 'completed') return failure(reminders, { form: 'Completed reminders cannot be edited.' });

        const check = validateReminderInput(input, ctx);
        if (!check.valid) return failure(reminders, check.errors);
        if (findDuplicate(reminders, check.value, id)) {
            return failure(reminders, { form: `You already have a reminder for ${check.value.medicine} at ${check.value.time}.` });
        }
        const updated = {
            ...existing,
            ...check.value,
            timeZone: (ctx && ctx.timeZone) || getLocalTimeZone(),
            // a changed time should be allowed to fire again today
            lastNotifiedOn: check.value.time === existing.time ? existing.lastNotifiedOn : ''
        };
        return { ok: true, errors: {}, reminders: reminders.map((r) => (r.id === id ? updated : r)), reminder: updated };
    }

    function setPaused(reminders, id, paused) {
        const existing = reminders.find((r) => r.id === id);
        if (!existing) return failure(reminders, { form: 'That reminder no longer exists.' });
        if (existing.status === 'completed') return failure(reminders, { form: 'Completed reminders cannot be paused or resumed.' });
        const updated = { ...existing, status: paused ? 'paused' : 'active' };
        return { ok: true, errors: {}, reminders: reminders.map((r) => (r.id === id ? updated : r)), reminder: updated };
    }

    function completeReminder(reminders, id) {
        const existing = reminders.find((r) => r.id === id);
        if (!existing) return failure(reminders, { form: 'That reminder no longer exists.' });
        const updated = { ...existing, status: 'completed' };
        return { ok: true, errors: {}, reminders: reminders.map((r) => (r.id === id ? updated : r)), reminder: updated };
    }

    function removeReminder(reminders, id) {
        const existing = reminders.find((r) => r.id === id);
        if (!existing) return failure(reminders, { form: 'That reminder no longer exists.' });
        return { ok: true, errors: {}, reminders: reminders.filter((r) => r.id !== id), reminder: existing };
    }

    function markNotified(reminders, id, date) {
        return reminders.map((r) => (r.id === id ? { ...r, lastNotifiedOn: date } : r));
    }

    // ---------- scheduling ----------

    /** One of: completed, paused, upcoming (start date not reached), expired (end date passed), active. */
    function getReminderState(reminder, now, timeZone) {
        if (reminder.status === 'completed') return 'completed';
        if (reminder.status === 'paused') return 'paused';
        const today = getLocalParts(now, timeZone).date;
        if (reminder.startDate && today < reminder.startDate) return 'upcoming';
        if (reminder.endDate && today > reminder.endDate) return 'expired';
        return 'active';
    }

    /** Active reminders whose time has been reached today and that were not already shown today. */
    function getDueReminders(reminders, now, timeZone) {
        const local = getLocalParts(now, timeZone);
        return reminders.filter((r) =>
            getReminderState(r, now, timeZone) === 'active' &&
            r.time <= local.time &&
            r.lastNotifiedOn !== local.date
        );
    }

    function countActive(reminders, now, timeZone) {
        return reminders.filter((r) => getReminderState(r, now, timeZone) === 'active').length;
    }

    // ---------- notifications and messages ----------

    /** 'unsupported' | 'default' | 'granted' | 'denied'. Pass window.Notification. */
    function getNotificationPermission(NotificationApi) {
        if (!NotificationApi || typeof NotificationApi.permission !== 'string') return 'unsupported';
        return NotificationApi.permission;
    }

    function getPermissionMessage(permission) {
        switch (permission) {
            case 'granted':
                return 'Browser notifications are on. You will also see a banner on this page.';
            case 'denied':
                return 'Browser notifications are blocked, so reminders will show as a banner on this page instead. You can allow them in your browser site settings.';
            case 'unsupported':
                return 'This browser does not support notifications, so reminders will show as a banner on this page.';
            default:
                return 'We can show a browser notification when a reminder is due. Your browser will ask for permission only after you press the button. Without it you still get a banner on this page.';
        }
    }

    function buildReminderMessage(reminder) {
        const note = reminder.instructions ? ` Note: ${reminder.instructions}` : '';
        return `Reminder: ${reminder.medicine} (set for ${reminder.time}).${note}`;
    }

    /** Returns a warning when the device time zone differs from the one saved with the reminder. */
    function getTimeZoneWarning(reminder, currentTimeZone) {
        if (!reminder.timeZone || reminder.timeZone === currentTimeZone) return '';
        return `Created in ${reminder.timeZone}. It now follows this device's clock (${currentTimeZone}).`;
    }

    const api = {
        REMINDERS_KEY,
        REMINDER_DISCLAIMER,
        PERSISTENCE_NOTE,
        TIMEZONE_NOTE,
        getLocalTimeZone,
        getLocalParts,
        isValidTime,
        isValidDate,
        escapeHtml,
        normalizeReminder,
        loadReminders,
        saveReminders,
        validateReminderInput,
        findDuplicate,
        addReminder,
        editReminder,
        setPaused,
        completeReminder,
        removeReminder,
        markNotified,
        getReminderState,
        getDueReminders,
        countActive,
        getNotificationPermission,
        getPermissionMessage,
        buildReminderMessage,
        getTimeZoneWarning
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (typeof window !== 'undefined') {
        window.ReliefReminders = api;
    }
})();
