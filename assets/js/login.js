document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');

    if (!loginForm) return;

    window.ReliefAuth.showDemoNotice(document.getElementById('demo-notice'));

    const existingSession = window.ReliefSession?.getCurrentSession?.();
    if (existingSession?.user) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Count only failed logins so normal users are never slowed down.
    const guard = window.ReliefFormGuard?.createGuard('login', {
        maxAttempts: 5,
        windowMs: 5 * 60 * 1000,
        minFillMs: 0,
        countFailuresOnly: true
    });
    window.ReliefFormGuard?.attachHoneypot(loginForm);
    // Editing a field clears its error mark and the message that described it.
    loginForm.querySelectorAll('input').forEach(function(input) {
        input.addEventListener('input', clearFieldErrors);
    });

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const password = document.getElementById('login-password').value;

        clearFieldErrors();

        const submitBtn = loginForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Logging in...';
        }

        try {
            const attempt = () => authenticateUser(email, password);
            const outcome = guard
                ? await guard.run(attempt, { honeypot: loginForm.elements['website']?.value })
                : await attempt().then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: error.message }));

            if (!outcome.ok) {
                showAlert('danger', outcome.message || 'Login failed. Please try again.');
                // The message is about the pair, so flag both and send the keyboard to the password.
                markInvalid(document.getElementById('login-email'));
                markInvalid(document.getElementById('login-password'), true);
                return;
            }

            window.ReliefSession?.createSession?.(outcome.value);
            showAlert('success', 'Login successful! Redirecting to dashboard...');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 800);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = window.ReliefI18n ? window.ReliefI18n.t('login.submit', 'Login') : 'Login';
            }
        }
    });
});

async function authenticateUser(email, password) {
    // ReliefAuth only uses the browser-only demo store in demo mode.
    return window.ReliefAuth.login(email, password);
}

const FORM_MESSAGE_ID = 'form-message';

function markInvalid(field, focus) {
    if (!field) return;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', FORM_MESSAGE_ID);
    if (focus) field.focus();
}

function clearFieldErrors() {
    document.querySelectorAll('#login-form [aria-invalid]').forEach(function(field) {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
    });
    const old = document.getElementById(FORM_MESSAGE_ID);
    if (old && old.classList.contains('alert-danger')) old.remove();
}

// Errors use role="alert" so a screen reader reads them out when they appear, and they stay until
// the person edits a field or submits again (the old 5 second timeout removed them too soon).
// Success uses role="status" because the page is about to redirect.
function showAlert(type, message) {
    const existingAlert = document.getElementById(FORM_MESSAGE_ID);
    if (existingAlert) {
        existingAlert.remove();
    }

    const alertDiv = document.createElement('div');
    alertDiv.id = FORM_MESSAGE_ID;
    alertDiv.className = `alert alert-${type} mt-3`;
    alertDiv.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    alertDiv.textContent = message;

    const form = document.getElementById('login-form');
    if (form) {
        form.appendChild(alertDiv);
    }
}
