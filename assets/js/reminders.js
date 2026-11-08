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
    const TIMEZONE_NOTE = 'Reminders use the clock time on this device and follow it if your time zone changes, unless you choose a fixed time zone. They only fire while this dashboard is open in a tab. See docs/REMINDER_SCHEDULING.md for the rules.';

    // A reminder never fires twice within this time. This protects against a repeat when the
    // device moves west across the date line or the time zone is changed after it fired.
    const MIN_GAP_MS = 6 * 60 * 60 * 1000;

    const SCHEDULE_MODES = ['local', 'fixed'];

    // ---------- date and time helpers ----------

    function getLocalTimeZone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch (e) {
            return 'UTC';
        }
    }

    /** True when the runtime knows this IANA time zone name. */
    function isValidTimeZone(timeZone) {
        if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
        try {
            new Intl.DateTimeFormat('en-CA', { timeZone: timeZone });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * The time zone a reminder is scheduled in: its own zone when fixed, otherwise the
     * device's current zone. An unknown zone name falls back to the device zone.
     */
    function getEffectiveTimeZone(reminder, deviceTimeZone) {
        const device = isValidTimeZone(deviceTimeZone) ? deviceTimeZone : getLocalTimeZone();
        if (reminder && reminder.scheduleMode === 'fixed' && isValidTimeZone(reminder.timeZone)) {
            return reminder.timeZone;
        }
        return device;
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
            // Older reminders have no mode. They always followed the device clock, so 'local'.
            scheduleMode: raw.scheduleMode === 'fixed' && isValidTimeZone(raw.timeZone) ? 'fixed' : 'local',
            timeZone: typeof raw.timeZone === 'string' ? raw.timeZone : '',
            lastNotifiedOn: isValidDate(raw.lastNotifiedOn) ? raw.lastNotifiedOn : '',
            lastNotifiedAtMs: Number.isFinite(raw.lastNotifiedAtMs) && raw.lastNotifiedAtMs > 0 ? raw.lastNotifiedAtMs : 0
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
        const src = input || {};
        const errors = {};

        const scheduleMode = src.scheduleMode === 'fixed' ? 'fixed' : 'local';
        const fixedZone = String(src.scheduleTimeZone || '').trim();
        if (src.scheduleMode !== undefined && src.scheduleMode !== '' && SCHEDULE_MODES.indexOf(src.scheduleMode) === -1) {
            errors.scheduleMode = 'Choose whether the reminder follows this device or a fixed time zone.';
        }
        if (scheduleMode === 'fixed' && !isValidTimeZone(fixedZone)) {
            errors.scheduleTimeZone = 'Choose a time zone from the list.';
        }
        // "Today" is the date in the zone the reminder runs in, so an end date behaves the same
        // for a fixed zone as it will when the reminder fires.
        const scheduleZone = scheduleMode === 'fixed' && !errors.scheduleTimeZone ? fixedZone : context.timeZone;
        const today = context.today || getLocalParts(context.now || new Date(), scheduleZone).date;

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
            value: { medicine, instructions, time, startDate, endDate, scheduleMode, scheduleTimeZone: scheduleMode === 'fixed' ? fixedZone : '' }
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

    /** Maps validated form values to the saved fields. For a fixed reminder timeZone is the fixed zone. */
    function scheduleFields(value, ctx) {
        const deviceZone = (ctx && ctx.timeZone) || getLocalTimeZone();
        const { scheduleTimeZone, ...rest } = value;
        return {
            ...rest,
            timeZone: value.scheduleMode === 'fixed' ? scheduleTimeZone : deviceZone
        };
    }

    /**
     * When a reminder is saved for a time that already passed today, the first reminder is tomorrow.
     * Returns today's date (in the schedule's zone) to mark today as done, or '' when today still counts.
     */
    function skipPassedToday(reminder, ctx) {
        const context = ctx || {};
        const zone = getEffectiveTimeZone(reminder, context.timeZone);
        const local = getLocalParts(context.now || new Date(), zone);
        if (reminder.startDate && local.date < reminder.startDate) return '';
        return reminder.time < local.time ? local.date : '';
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
            ...scheduleFields(check.value, ctx),
            status: 'active',
            lastNotifiedOn: '',
            lastNotifiedAtMs: 0
        };
        reminder.lastNotifiedOn = skipPassedToday(reminder, ctx) || '';
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
            ...scheduleFields(check.value, ctx)
        };
        const scheduleChanged = check.value.time !== existing.time ||
            updated.scheduleMode !== existing.scheduleMode ||
            (updated.scheduleMode === 'fixed' && updated.timeZone !== existing.timeZone);
        if (scheduleChanged) {
            // A new schedule starts clean. A time that has already passed today waits until tomorrow.
            updated.lastNotifiedOn = skipPassedToday(updated, ctx) || '';
            updated.lastNotifiedAtMs = 0;
        }
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

    /** Records that a reminder fired: the local date it was for and the instant (ms) it fired. */
    function markNotified(reminders, id, date, atMs) {
        const at = Number.isFinite(atMs) ? atMs : Date.now();
        return reminders.map((r) => (r.id === id ? { ...r, lastNotifiedOn: date, lastNotifiedAtMs: at } : r));
    }

    // ---------- scheduling ----------

    /** One of: completed, paused, upcoming (start date not reached), expired (end date passed), active. */
    function getReminderState(reminder, now, deviceTimeZone) {
        if (reminder.status === 'completed') return 'completed';
        if (reminder.status === 'paused') return 'paused';
        // Start and end dates are read in the zone the reminder runs in.
        const today = getLocalParts(now, getEffectiveTimeZone(reminder, deviceTimeZone)).date;
        if (reminder.startDate && today < reminder.startDate) return 'upcoming';
        if (reminder.endDate && today > reminder.endDate) return 'expired';
        return 'active';
    }

    /**
     * Active reminders whose time has been reached in their own zone, that did not already fire
     * for that date, and that did not fire within the last MIN_GAP_MS.
     *
     * "Reached" means the zone's clock is at or past the set time, so a time skipped by a
     * daylight saving change fires right after the gap, and a time that happens twice fires once.
     * If the device clock was moved back (the last firing is "in the future") the gap check is
     * skipped, because a repeated reminder is safer than a missed one.
     */
    function getDueReminders(reminders, now, deviceTimeZone) {
        const nowMs = now.getTime();
        return reminders.filter((r) => {
            if (getReminderState(r, now, deviceTimeZone) !== 'active') return false;
            const local = getLocalParts(now, getEffectiveTimeZone(r, deviceTimeZone));
            if (r.time > local.time || r.lastNotifiedOn === local.date) return false;
            const since = nowMs - (r.lastNotifiedAtMs || 0);
            return !(r.lastNotifiedAtMs && since >= 0 && since < MIN_GAP_MS);
        });
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

    /** Returns a note when the device time zone differs from the one saved with the reminder. */
    function getTimeZoneWarning(reminder, currentTimeZone) {
        if (!reminder.timeZone || reminder.timeZone === currentTimeZone) return '';
        if (reminder.scheduleMode === 'fixed') {
            return `Fixed to ${reminder.timeZone}. This device is in ${currentTimeZone}, so it fires at ${localEquivalent(reminder, new Date(), currentTimeZone)} here today.`;
        }
        return `Created in ${reminder.timeZone}. It now follows this device's clock (${currentTimeZone}).`;
    }

    /** The device clock time (HH:MM) at the moment a fixed-zone reminder's time is reached today. */
    function localEquivalent(reminder, now, deviceTimeZone) {
        const zone = getEffectiveTimeZone(reminder, deviceTimeZone);
        const zoneNow = getLocalParts(now, zone);
        const deviceNow = getLocalParts(now, deviceTimeZone);
        const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        const diff = toMinutes(deviceNow.time) - toMinutes(zoneNow.time);
        const dayShift = Math.round((Date.parse(deviceNow.date) - Date.parse(zoneNow.date)) / 86400000);
        const total = toMinutes(reminder.time) + diff + dayShift * 1440;
        const wrapped = ((total % 1440) + 1440) % 1440;
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
    }

    /**
     * Plain-language description of when a reminder will fire, shown before it is saved.
     * Returns '' until a valid time is given.
     */
    function explainSchedule(input, now, deviceTimeZone) {
        const src = input || {};
        if (!isValidTime(src.time)) return '';
        const device = isValidTimeZone(deviceTimeZone) ? deviceTimeZone : getLocalTimeZone();
        const fixed = src.scheduleMode === 'fixed';
        const zone = fixed ? String(src.scheduleTimeZone || '').trim() : device;
        if (fixed && !isValidTimeZone(zone)) return 'Choose a time zone to see when this reminder will fire.';

        const probe = { time: src.time, scheduleMode: fixed ? 'fixed' : 'local', timeZone: zone };
        const startDate = isValidDate(src.startDate) ? src.startDate : '';
        const local = getLocalParts(now, zone);
        const futureStart = startDate && local.date < startDate;
        const first = futureStart ? `on ${startDate}` : (src.time < local.time ? 'tomorrow' : 'today');

        const lines = [];
        if (fixed) {
            lines.push(`Every day at ${src.time} in ${zone}.`);
            if (zone !== device) lines.push(`That is ${localEquivalent(probe, now, device)} on this device now (${device}).`);
            lines.push('It stays on that time zone if you travel.');
        } else {
            lines.push(`Every day at ${src.time} on this device's clock (${device}).`);
            lines.push('If you travel or change the device time zone, it follows the new local time.');
        }
        lines.push('If daylight saving skips this time, it appears right after. If the time happens twice, it appears once.');
        lines.push(`First reminder: ${first}${futureStart ? '' : ' at ' + src.time}.`);
        return lines.join(' ');
    }

    const api = {
        REMINDERS_KEY,
        REMINDER_DISCLAIMER,
        PERSISTENCE_NOTE,
        TIMEZONE_NOTE,
        MIN_GAP_MS,
        SCHEDULE_MODES,
        getLocalTimeZone,
        isValidTimeZone,
        getEffectiveTimeZone,
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
        getTimeZoneWarning,
        localEquivalent,
        explainSchedule
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (typeof window !== 'undefined') {
        window.ReliefReminders = api;
    }
})();
