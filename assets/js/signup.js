document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signup-form');

    if (!signupForm) return;

    const existingSession = window.ReliefSession?.getCurrentSession?.();
    if (existingSession?.user) {
        window.location.href = 'dashboard.html';
        return;
    }

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
            const user = await createUser(name, email, password);
            window.ReliefSession?.createSession?.(user);
            showAlert('success', 'Account created successfully! Redirecting to dashboard...');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 800);
        } catch (error) {
            showAlert('danger', error.message || 'Signup failed. Please try again.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign Up';
            }
        }
    });
});

async function createUser(name, email, password) {
    if (typeof ReliefAPI !== 'undefined' && ReliefAPI.signup) {
        try {
            return await ReliefAPI.signup({ name, email, password, joined: new Date().toISOString() });
        } catch (error) {
            console.warn('API signup unavailable, falling back to local auth:', error);
        }
    }

    const users = JSON.parse(localStorage.getItem('relief_users') || '[]');
    if (users.some(item => item.email === email)) {
        throw new Error('Email already in use. Please login instead.');
    }

    const localUser = {
        id: `user_${Date.now()}`,
        name,
        email,
        password,
        createdAt: new Date().toISOString()
    };

    users.push(localUser);
    localStorage.setItem('relief_users', JSON.stringify(users));

    return {
        uid: localUser.id,
        email: localUser.email,
        name: localUser.name
    };
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
