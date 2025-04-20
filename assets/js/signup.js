import { auth, db } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signup-form');
    
    if (signupForm) {
        signupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('signup-name').value;
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const confirmPassword = document.getElementById('signup-confirm-password').value;
            
            // Client-side validation
            if (password !== confirmPassword) {
                showAlert('danger', 'Passwords do not match.');
                return;
            }
            
            if (password.length < 6) {
                showAlert('danger', 'Password must be at least 6 characters.');
                return;
            }
            
            try {
                // Show loading state
                const submitBtn = signupForm.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creating account...';
                
                await handleSignup(name, email, password);
            } catch (error) {
                console.error('Signup error:', error);
                // Error handling is done in handleSignup
            }
        });
    }
});

async function handleSignup(name, email, password) {
    try {
        // Create user in Firebase Auth
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        
        // Save additional user data in Firestore
        await db.collection('users').doc(userCredential.user.uid).set({
            name,
            email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Store user in localStorage
        localStorage.setItem('currentUser', JSON.stringify({
            id: userCredential.user.uid,
            email,
            name
        }));
        
        // Show success message
        showAlert('success', 'Account created successfully! Redirecting...');
        
        // Redirect after short delay
        setTimeout(() => {
            window.location.href = '../index.html';
        }, 1500);
        
    } catch (error) {
        let errorMessage = 'Signup failed. Please try again.';
        
        // More specific error messages
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = 'Email already in use. Please login instead.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Please enter a valid email address.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = 'Password should be at least 6 characters.';
        }
        
        showAlert('danger', errorMessage);
        console.error('Signup error:', error);
    } finally {
        // Reset button state
        const submitBtn = document.querySelector('#signup-form button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign Up';
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
    
    const form = document.getElementById('signup-form');
    if (form) {
        form.appendChild(alertDiv);
    }
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}