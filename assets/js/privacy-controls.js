/**
 * Relief - "Your data and account" section on the dashboard (Issue #29).
 * Wires the delete button, the confirmation step and the result message.
 * The deletion itself lives in privacy-data.js.
 */
document.addEventListener('DOMContentLoaded', () => {
    const P = window.ReliefPrivacy;
    const deleteBtn = document.getElementById('privacy-delete');
    if (!P || !deleteBtn) return;

    const stored = document.getElementById('privacy-stored');
    const confirmBox = document.getElementById('privacy-confirm');
    const confirmTitle = document.getElementById('privacy-confirm-title');
    const yesBtn = document.getElementById('privacy-confirm-yes');
    const cancelBtn = document.getElementById('privacy-confirm-cancel');
    const status = document.getElementById('privacy-status');

    // "Clear data stored in this browser": the local half only, no server step (privacy-data.js clearLocalData).
    const clearBtn = document.getElementById('privacy-clear');
    const clearConfirm = document.getElementById('privacy-clear-confirm');
    const clearTitle = document.getElementById('privacy-clear-title');
    const clearList = document.getElementById('privacy-clear-list');
    const clearOther = document.getElementById('privacy-clear-other');
    const clearYes = document.getElementById('privacy-clear-yes');
    const clearCancel = document.getElementById('privacy-clear-cancel');

    function renderStored() {
        const rows = P.describeStored();
        stored.innerHTML = '';
        if (!rows.length) {
            const li = document.createElement('li');
            li.className = 'muted';
            li.textContent = 'Nothing. RELIEF has no data stored in this browser.';
            stored.appendChild(li);
            return;
        }
        rows.forEach((row) => {
            const li = document.createElement('li');
            li.textContent = row.label;
            stored.appendChild(li);
        });
    }

    function showStatus(tone, headline, lines) {
        status.className = 'privacy-status' + (tone ? ' privacy-status--' + tone : '');
        status.textContent = '';
        const h = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = headline;
        h.appendChild(strong);
        status.appendChild(h);
        (lines || []).forEach((line) => {
            const p = document.createElement('p');
            p.textContent = line;
            status.appendChild(p);
        });
        status.hidden = false;
    }

    function openConfirm() {
        closeClearConfirm();
        status.hidden = true;
        confirmBox.hidden = false;
        deleteBtn.setAttribute('aria-expanded', 'true');
        confirmTitle.focus();
    }

    function closeConfirm() {
        confirmBox.hidden = true;
        deleteBtn.setAttribute('aria-expanded', 'false');
    }

    function currentUser() {
        try {
            const session = window.ReliefSession && window.ReliefSession.getCurrentSession();
            return session && session.user ? session.user : null;
        } catch (e) {
            return null;
        }
    }

    async function runDeletion() {
        yesBtn.disabled = true;
        cancelBtn.disabled = true;
        showStatus('', 'Deleting...', ['Please wait. Do not close this page.']);

        // Read the signed-in user before the session keys are removed.
        const user = currentUser();
        const api = typeof ReliefAPI !== 'undefined' ? ReliefAPI : null;

        let result;
        try {
            result = await P.deleteAccount({ storage: window.localStorage, api, user });
        } catch (e) {
            result = { status: 'failed', local: { state: 'unavailable', found: [], removed: [], failed: [], remaining: [] }, server: { state: 'unavailable', message: '' } };
        }

        yesBtn.disabled = false;
        cancelBtn.disabled = false;
        closeConfirm();

        // Lets the dashboard drop what it holds in memory so it does not save it again.
        document.dispatchEvent(new CustomEvent('relief:data-deleted', { detail: result }));
        if (typeof updateAuthUI === 'function') updateAuthUI(null);

        const text = P.describeResult(result);
        showStatus(text.tone, text.headline, text.lines);
        renderStored();
        status.focus();
    }

    deleteBtn.addEventListener('click', openConfirm);

    // ---- clear data stored in this browser ----

    function closeClearConfirm() {
        if (!clearConfirm) return;
        clearConfirm.hidden = true;
        clearBtn.setAttribute('aria-expanded', 'false');
    }

    // Lists exactly what is in storage and would go, read again each time the box opens.
    function openClearConfirm() {
        closeConfirm();
        status.hidden = true;
        clearList.textContent = '';
        const rows = P.describeStored();
        rows.forEach((row) => {
            const li = document.createElement('li');
            li.textContent = row.label + ' ';
            const code = document.createElement('code');
            code.textContent = row.key;
            li.appendChild(code);
            clearList.appendChild(li);
        });
        if (!rows.length) {
            const li = document.createElement('li');
            li.textContent = 'Nothing. RELIEF has no data stored in this browser.';
            clearList.appendChild(li);
        }
        const others = P.countOtherKeys();
        clearOther.textContent = others === null
            ? 'Anything else stored for this site by other apps is kept.'
            : others + (others === 1 ? ' other item' : ' other items') + ' stored for this site by other apps will be kept.';
        clearYes.disabled = !rows.length;
        clearConfirm.hidden = false;
        clearBtn.setAttribute('aria-expanded', 'true');
        clearTitle.focus();
    }

    function runClear() {
        let result;
        try {
            result = P.clearLocalData(window.localStorage);
        } catch (e) {
            result = { status: 'failed', local: { state: 'unavailable', found: [], removed: [], failed: [], remaining: [] }, server: { state: 'not-contacted', message: '' } };
        }
        closeClearConfirm();
        // Same event as the full deletion, so the dashboard drops what it holds in memory.
        document.dispatchEvent(new CustomEvent('relief:data-deleted', { detail: result }));
        if (typeof updateAuthUI === 'function') updateAuthUI(null);

        const text = P.describeClearResult(result);
        showStatus(text.tone, text.headline, text.lines);
        renderStored();
        status.focus();
    }

    if (clearBtn && clearConfirm) {
        clearBtn.addEventListener('click', openClearConfirm);
        clearYes.addEventListener('click', runClear);
        clearCancel.addEventListener('click', () => {
            closeClearConfirm();
            showStatus('', 'Cancelled. Nothing was cleared.', []);
            clearBtn.focus();
        });
        clearConfirm.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') clearCancel.click();
        });
    }

    cancelBtn.addEventListener('click', () => {
        closeConfirm();
        showStatus('', 'Cancelled. Nothing was deleted.', []);
        deleteBtn.focus();
    });

    yesBtn.addEventListener('click', runDeletion);

    confirmBox.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !yesBtn.disabled) cancelBtn.click();
    });

    renderStored();
});
