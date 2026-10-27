document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signup-form');

    if (!signupForm) return;

    window.ReliefAuth.showDemoNotice(document.getElementById('demo-notice'));

    const existingSession = window.ReliefSession?.getCurrentSession?.();
    if (existingSession?.user) {
        window.location.href = 'dashboard.html';
        return;
    }

    const guard = window.ReliefFormGuard?.createGuard('signup', {
        maxAttempts: 5,
        windowMs: 10 * 60 * 1000,
        minFillMs: 0
    });
    window.ReliefFormGuard?.attachHoneypot(signupForm);
    // Editing a field clears its error mark and the message that described it.
    signupForm.querySelectorAll('input').forEach(function(input) {
        input.addEventListener('input', clearFieldErrors);
    });

    signupForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim().toLowerCase();
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm-password').value;

        clearFieldErrors();

        if (password !== confirmPassword) {
            showAlert('danger', 'Passwords do not match.');
            markInvalid(document.getElementById('signup-confirm-password'), true);
            return;
        }

        if (password.length < 6) {
            showAlert('danger', 'Password must be at least 6 characters.');
            markInvalid(document.getElementById('signup-password'), true);
            return;
        }

        const submitBtn = signupForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating account...';
        }

        try {
            const attempt = () => createUser(name, email, password);
            const outcome = guard
                ? await guard.run(attempt, { honeypot: signupForm.elements['website']?.value })
                : await attempt().then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: error.message }));

            if (!outcome.ok) {
                const message = outcome.message || 'Signup failed. Please try again.';
                showAlert('danger', message);
                if (/email/i.test(message)) markInvalid(document.getElementById('signup-email'), true);
                return;
            }

            window.ReliefSession?.createSession?.(outcome.value);
            showAlert('success', 'Account created successfully! Redirecting to dashboard...');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 800);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = window.ReliefI18n ? window.ReliefI18n.t('signup.submit', 'Sign Up') : 'Sign Up';
            }
        }
    });
});

async function createUser(name, email, password) {
    // ReliefAuth only uses the browser-only demo store in demo mode.
    return window.ReliefAuth.signup(name, email, password);
}

const FORM_MESSAGE_ID = 'form-message';

function markInvalid(field, focus) {
    if (!field) return;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', FORM_MESSAGE_ID);
    if (focus) field.focus();
}

function clearFieldErrors() {
    document.querySelectorAll('#signup-form [aria-invalid]').forEach(function(field) {
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

    const form = document.getElementById('signup-form');
    if (form) {
        form.appendChild(alertDiv);
    }
}
