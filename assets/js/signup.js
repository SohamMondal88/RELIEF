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
    // Editing a field clears its own error (form-errors.js) and any message the server answer left behind.
    signupForm.querySelectorAll('input').forEach(function(input) {
        input.addEventListener('input', clearFieldErrors);
    });
    window.ReliefFormErrors.bindFieldClearing(document, SIGNUP_ERROR_OPTIONS);
    window.ReliefFormErrors.bindSummaryLinks(document, SIGNUP_ERROR_OPTIONS.summaryId);

    signupForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim().toLowerCase();
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm-password').value;

        clearFieldErrors();

        // Every problem is shown next to its field. One problem sends focus to its field, several send it to
        // the summary that links to each field. What was typed stays in the form.
        const problems = window.ReliefAuth.validateSignup({
            name,
            email,
            password,
            confirmPassword,
            terms: document.getElementById('terms').checked
        });
        if (Object.keys(problems).length > 0) {
            window.ReliefFormErrors.applyErrors(document, problems, SIGNUP_ERROR_OPTIONS);
            return;
        }
        window.ReliefFormErrors.clearErrors(document, SIGNUP_ERROR_OPTIONS);

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

const SIGNUP_ERROR_OPTIONS = {
    fields: {
        name: { focusId: 'signup-name', errorId: 'signup-name-error' },
        email: { focusId: 'signup-email', errorId: 'signup-email-error' },
        password: { focusId: 'signup-password', errorId: 'signup-password-error' },
        confirmPassword: { focusId: 'signup-confirm-password', errorId: 'signup-confirm-password-error' },
        terms: { focusId: 'terms', errorId: 'terms-error' }
    },
    order: ['name', 'email', 'password', 'confirmPassword', 'terms'],
    summaryId: 'signup-error-summary',
    title: 'Please fix the following'
};

function markInvalid(field, focus) {
    if (!field) return;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', FORM_MESSAGE_ID);
    if (focus) field.focus();
}

// Removes the message from a refused sign-up and the marks it put on the fields.
function clearFieldErrors() {
    const old = document.getElementById(FORM_MESSAGE_ID);
    if (!old || !old.classList.contains('alert-danger')) return;
    document.querySelectorAll('#signup-form [aria-describedby~="' + FORM_MESSAGE_ID + '"]').forEach(function(field) {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
    });
    old.remove();
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
