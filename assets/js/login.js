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

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const password = document.getElementById('login-password').value;

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

function showAlert(type, message) {
    const existingAlert = document.querySelector('.alert');
    if (existingAlert) {
        existingAlert.remove();
    }

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} mt-3`;
    alertDiv.textContent = message;

    const form = document.getElementById('login-form');
    if (form) {
        form.appendChild(alertDiv);
    }

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}
