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

    signupForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim().toLowerCase();
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm-password').value;

        if (password !== confirmPassword) {
            showAlert('danger', 'Passwords do not match.');
            return;
        }

        if (password.length < 6) {
            showAlert('danger', 'Password must be at least 6 characters.');
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
                showAlert('danger', outcome.message || 'Signup failed. Please try again.');
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

function showAlert(type, message) {
    const existingAlert = document.querySelector('.alert');
    if (existingAlert) {
        existingAlert.remove();
    }

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} mt-3`;
    alertDiv.textContent = message;

    const form = document.getElementById('signup-form');
    if (form) {
        form.appendChild(alertDiv);
    }

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}
