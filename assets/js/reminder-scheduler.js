/**
 * Reminder due-check loop (Issue #183).
 *
 * Owns the one timer that looks for due reminders, so the dashboard cannot end up with two of
 * them. Timers, clock, storage and event targets are all injectable, which is how
 * tests/reminder-scheduler.test.js runs it with fake timers and no browser.
 *
 * Every check reads the reminders from storage again and saves "already fired" BEFORE it
 * delivers anything. Two tabs on the same storage therefore agree: the first one to check
 * marks the reminder, and the second one finds it already marked.
 *
 * Reminders still only fire while the dashboard is open. See docs/REMINDER_SCHEDULING.md.
 */

(function () {
    'use strict';

    const DEFAULT_INTERVAL_MS = 30000;

    function defaultReminders() {
        if (typeof module !== 'undefined' && module.exports) return require('./reminders.js');
        return typeof window !== 'undefined' ? window.ReliefReminders : null;
    }

    /**
     * options:
     *   storage       localStorage-like object (getItem / setItem). Required.
     *   timeZone      the device time zone the reminders are checked in.
     *   deliver(due, now)         called with the reminders that just became due, after they are saved.
     *   onChange(reminders, saved) called with the reminders read from storage, so the page can drop
     *                              its older copy. saved is false when the browser refused the write.
     *   intervalMs    time between checks (default 30 s).
     *   now           () => Date, the clock.
     *   setInterval / clearInterval  timer functions.
     *   documentTarget / windowTarget  where visibilitychange and pageshow / storage events come from.
     *   reminders     the ReliefReminders API (defaults to the loaded one).
     */
    function createScheduler(options) {
        const opts = options || {};
        const R = opts.reminders || defaultReminders();
        const storage = opts.storage;
        const intervalMs = opts.intervalMs > 0 ? opts.intervalMs : DEFAULT_INTERVAL_MS;
        const getNow = opts.now || (() => new Date());
        const setTimer = opts.setInterval || ((fn, ms) => setInterval(fn, ms));
        const clearTimer = opts.clearInterval || ((id) => clearInterval(id));
        const docTarget = opts.documentTarget || (typeof document !== 'undefined' ? document : null);
        const winTarget = opts.windowTarget || (typeof window !== 'undefined' ? window : null);

        let timer = null;
        let running = false;
        // Reminders that fired but could not be saved (storage full or blocked). They are
        // remembered here so a broken storage does not make the same reminder fire every 30 seconds.
        const unsaved = new Map();

        function loadFresh() {
            let list = R.loadReminders(storage);
            unsaved.forEach((mark, id) => {
                if (list.some((r) => r.id === id && r.lastNotifiedOn !== mark.date)) {
                    list = R.markNotified(list, id, mark.date, mark.at);
                }
            });
            return list;
        }

        /** Reads storage, marks and saves what is due, then delivers it. Returns the due reminders. */
        function check() {
            const now = getNow();
            let list = loadFresh();
            const due = R.getDueReminders(list, now, opts.timeZone);
            if (!due.length) return [];

            due.forEach((r) => {
                const date = R.getLocalParts(now, R.getEffectiveTimeZone(r, opts.timeZone)).date;
                list = R.markNotified(list, r.id, date, now.getTime());
                unsaved.set(r.id, { date, at: now.getTime() });
            });
            const saved = R.saveReminders(storage, list);
            if (saved) unsaved.clear();

            if (typeof opts.onChange === 'function') opts.onChange(list, saved);
            if (typeof opts.deliver === 'function') opts.deliver(due, now);
            return due;
        }

        // Waking from sleep or coming back to the tab: the timer may have been throttled or frozen.
        function onVisibilityChange() {
            if (docTarget && docTarget.visibilityState === 'hidden') return;
            check();
        }

        function onPageShow() {
            check();
        }

        // Another tab changed the reminders: take its copy so this tab does not write an older one back.
        function onStorage(event) {
            if (event && event.key !== null && event.key !== R.REMINDERS_KEY) return;
            if (typeof opts.onChange === 'function') opts.onChange(loadFresh(), true);
        }

        function start() {
            if (running) return false;
            running = true;
            timer = setTimer(check, intervalMs);
            if (docTarget) docTarget.addEventListener('visibilitychange', onVisibilityChange);
            if (winTarget) {
                winTarget.addEventListener('pageshow', onPageShow);
                winTarget.addEventListener('storage', onStorage);
            }
            check();
            return true;
        }

        function stop() {
            if (!running) return false;
            running = false;
            clearTimer(timer);
            timer = null;
            if (docTarget) docTarget.removeEventListener('visibilitychange', onVisibilityChange);
            if (winTarget) {
                winTarget.removeEventListener('pageshow', onPageShow);
                winTarget.removeEventListener('storage', onStorage);
            }
            return true;
        }

        return { start, stop, check, isRunning: () => running };
    }

    const api = { DEFAULT_INTERVAL_MS, createScheduler };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (typeof window !== 'undefined') {
        window.ReliefReminderScheduler = api;
    }
})();
