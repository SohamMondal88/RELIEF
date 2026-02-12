import { auth, db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            try {
                // Show loading state
                const submitBtn = loginForm.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Logging in...';

                await handleLogin(email, password);
            } catch (error) {
                console.error('Login error:', error);
                // Error handling is done in handleLogin
            }
        });
    }
});

async function handleLogin(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const userDoc = await db.collection('users').doc(userCredential.user.uid).get();

        if (!userDoc.exists) {
            throw new Error('User data not found. Please contact support.');
        }

        const userData = userDoc.data();

        // Store user in localStorage
        localStorage.setItem('currentUser', JSON.stringify({
            id: userCredential.user.uid,
            email: userCredential.user.email,
            name: userData.name
        }));

        // Show success message
        showAlert('success', 'Login successful! Redirecting...');

        // Redirect after short delay
        setTimeout(() => {
            window.location.href = '../index.html';
        }, 1500);

    } catch (error) {
        let errorMessage = 'Login failed. Please try again.';

        // More specific error messages
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'No account found with this email.';
        } else if (error.code === 'auth/wrong-password') {
            errorMessage = 'Incorrect password. Please try again.';
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = 'Account temporarily locked due to too many failed attempts.';
        }

        showAlert('danger', errorMessage);
        console.error('Login error:', error);
    } finally {
        // Reset button state
        const submitBtn = document.querySelector('#login-form button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Login';
        }
    }
}

function showAlert(type, message) {
    // Remove any existing alerts
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

    // Auto-remove after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}
