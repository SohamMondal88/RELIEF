/**
 * Relief - "Back up or restore" section on the dashboard (Issue #82).
 * Wires the download button, the file picker, the preview and the replace/cancel buttons.
 * The checking and writing live in data-backup.js.
 */
document.addEventListener('DOMContentLoaded', () => {
    const B = window.ReliefDataBackup;
    const exportBtn = document.getElementById('backup-export');
    const fileInput = document.getElementById('backup-file');
    if (!B || !exportBtn || !fileInput) return;

    const preview = document.getElementById('backup-preview');
    const previewTitle = document.getElementById('backup-preview-title');
    const previewList = document.getElementById('backup-preview-list');
    const previewNames = document.getElementById('backup-preview-names');
    const applyBtn = document.getElementById('backup-apply');
    const cancelBtn = document.getElementById('backup-cancel');
    const status = document.getElementById('backup-status');

    // The checked file waiting for the user's decision. Nothing is written until they press Replace.
    let pending = null;

    function say(tone, headline, lines) {
        status.className = 'backup-status' + (tone ? ' backup-status--' + tone : '');
        status.textContent = '';
        const strong = document.createElement('strong');
        strong.textContent = headline;
        const head = document.createElement('p');
        head.appendChild(strong);
        status.appendChild(head);
        (lines || []).forEach((line) => {
            const p = document.createElement('p');
            p.textContent = line;
            status.appendChild(p);
        });
        status.hidden = false;
    }

    function closePreview() {
        pending = null;
        preview.hidden = true;
        fileInput.value = '';
    }

    const reminderCount = (n) => n + (n === 1 ? ' reminder' : ' reminders');
    const entryCount = (n) => n + (n === 1 ? ' timeline entry' : ' timeline entries');

    exportBtn.addEventListener('click', () => {
        closePreview();
        const now = new Date();
        const data = B.collect(window.localStorage);
        if (!data.reminders.length && !data.timeline.length) {
            say('warning', 'There is nothing to back up yet.', ['Add a reminder first. Nothing was downloaded.']);
            return;
        }
        const text = JSON.stringify(B.buildBackup(window.localStorage, now), null, 2);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = B.backupFileName(now);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        say('success', 'Backup downloaded.', [
            'It has ' + reminderCount(data.reminders.length) + ' and ' + entryCount(data.timeline.length) + '. The file is saved where your browser puts downloads.',
            'Anyone who opens it can read your medicine names, so keep it somewhere private. Deleting your data in RELIEF does not delete this file.'
        ]);
    });

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        closePreview();
        if (!file) return;

        // Check the size before reading anything into memory.
        if (file.size > B.MAX_BYTES) {
            say('error', 'That file is too large to be a RELIEF backup.', ['It is bigger than ' + (B.MAX_BYTES / 1024) + ' KB. Nothing was changed.']);
            fileInput.value = '';
            return;
        }

        let text;
        try {
            text = await file.text();
        } catch (e) {
            say('error', 'That file could not be read.', ['Nothing was changed.']);
            fileInput.value = '';
            return;
        }

        const result = B.parseBackup(text);
        if (!result.ok) {
            say('error', 'That file was not loaded.', [result.message].concat(result.problems));
            fileInput.value = '';
            return;
        }

        const info = B.describeImport(result.backup, window.localStorage);
        pending = result.backup;
        previewTitle.textContent = 'Replace what is saved here with this backup?';
        previewList.textContent = '';
        [
            'In the file: ' + reminderCount(info.file.reminders) + ' and ' + entryCount(info.file.timeline) + (info.exportedAt ? ', made ' + info.exportedAt.slice(0, 10) : '') + '.',
            'Saved in this browser now: ' + reminderCount(info.current.reminders) + ' and ' + entryCount(info.current.timeline) + '. These will be replaced, not merged, and it cannot be undone.'
        ].forEach((line) => {
            const li = document.createElement('li');
            li.textContent = line;
            previewList.appendChild(li);
        });
        previewNames.textContent = info.reminders.length ? 'Reminders in the file: ' + info.reminders.join(', ') + '.' : 'The file has no reminders, so your saved reminders will be emptied.';
        status.hidden = true;
        preview.hidden = false;
        previewTitle.focus();
    });

    cancelBtn.addEventListener('click', () => {
        closePreview();
        say('', 'Cancelled. Nothing was changed.', []);
        fileInput.focus();
    });

    applyBtn.addEventListener('click', () => {
        if (!pending) return;
        const result = B.applyBackup(window.localStorage, pending);
        closePreview();
        if (!result.ok) {
            say('error', 'The backup was not restored.', [result.message]);
            return;
        }
        // Lets the dashboard reload the reminders and timeline it holds in memory.
        document.dispatchEvent(new CustomEvent('relief:data-imported', { detail: result }));
        say('success', 'Backup restored.', ['Your reminders and timeline are now the ones from the file.']);
        status.focus();
    });

    preview.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancelBtn.click();
    });
});
