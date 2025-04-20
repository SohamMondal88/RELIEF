// Splash Screen
document.addEventListener('DOMContentLoaded', function() {
    // Only proceed if splash screen exists
    const splashScreen = document.querySelector('.splash-screen');
    const mainContent = document.querySelector('.main-content');
    
    if (splashScreen) {
        // Hide splash screen after 3 seconds
        setTimeout(function() {
            splashScreen.style.opacity = '0';
            
            if (mainContent) {
                mainContent.style.display = 'block';
            }

            // Remove splash screen from DOM after fade out
            setTimeout(function() {
                if (splashScreen.parentNode) {
                    splashScreen.parentNode.removeChild(splashScreen);
                }
            }, 500);
        }, 3000);
    } else if (mainContent) {
        mainContent.style.display = 'block';
    }

    // Mobile Menu Toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', function() {
            this.classList.toggle('active');
            navLinks.classList.toggle('active');
        });
    }

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: 'smooth'
                });
                
                // Close mobile menu if open
                if (navLinks && navLinks.classList.contains('active')) {
                    hamburger.classList.remove('active');
                    navLinks.classList.remove('active');
                }
            }
        });
    });

    // Animation on scroll
    function animateOnScroll() {
        const elements = document.querySelectorAll('.feature-card, .section-title');
        
        elements.forEach(element => {
            const elementPosition = element.getBoundingClientRect().top;
            const screenPosition = window.innerHeight / 1.3;
            
            if (elementPosition < screenPosition) {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }
        });
    }

    // Set initial state for animated elements
    const animatedElements = document.querySelectorAll('.feature-card, .section-title');
    if (animatedElements.length > 0) {
        animatedElements.forEach(element => {
            element.style.opacity = '0';
            element.style.transform = 'translateY(20px)';
            element.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        });

        // Run on load and scroll
        window.addEventListener('load', animateOnScroll);
        window.addEventListener('scroll', animateOnScroll);
    }

    // Check if user is logged in
    if (typeof ReliefAPI !== 'undefined') {
        checkAuthStatus();
    }
});

// Check authentication status and update UI
function checkAuthStatus() {
    if (typeof ReliefAPI === 'undefined') return;
    
    ReliefAPI.getCurrentUser().then(user => {
        updateAuthUI(user);
    }).catch(error => {
        console.error('Error checking auth status:', error);
        updateAuthUI(null);
    });
}

// Update UI based on authentication status
function updateAuthUI(user) {
    const loginButtons = document.querySelectorAll('.btn-login');
    const signupButtons = document.querySelectorAll('.btn-signup');
    const userMenuItems = document.querySelectorAll('.user-menu');
    
    if (user) {
        // User is logged in
        loginButtons.forEach(btn => btn.style.display = 'none');
        signupButtons.forEach(btn => btn.style.display = 'none');
        userMenuItems.forEach(item => {
            if (item) {
                item.style.display = 'block';
                const userNameElement = item.querySelector('.user-name');
                if (userNameElement) {
                    userNameElement.textContent = user.name || 'User';
                }
            }
        });
    } else {
        // User is not logged in
        loginButtons.forEach(btn => btn.style.display = 'block');
        signupButtons.forEach(btn => btn.style.display = 'block');
        userMenuItems.forEach(item => {
            if (item) item.style.display = 'none';
        });
    }
}

// Form Validation for Login/Signup
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        let isValid = true;
        
        // Validate email
        const email = form.querySelector('input[type="email"]');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
            isValid = false;
            if (email.nextElementSibling) {
                email.nextElementSibling.textContent = 'Please enter a valid email address';
            }
        } else if (email && email.nextElementSibling) {
            email.nextElementSibling.textContent = '';
        }
        
        // Validate password (for login/signup)
        const password = form.querySelector('input[type="password"]');
        if (password && password.value.length < 6) {
            isValid = false;
            if (password.nextElementSibling) {
                password.nextElementSibling.textContent = 'Password must be at least 6 characters';
            }
        } else if (password && password.nextElementSibling) {
            password.nextElementSibling.textContent = '';
        }
        
        // Validate password confirmation (for signup)
        const confirmPassword = form.querySelector('input[name="confirm-password"]');
        if (confirmPassword && confirmPassword.value !== password?.value) {
            isValid = false;
            if (confirmPassword.nextElementSibling) {
                confirmPassword.nextElementSibling.textContent = 'Passwords do not match';
            }
        } else if (confirmPassword && confirmPassword.nextElementSibling) {
            confirmPassword.nextElementSibling.textContent = '';
        }
        
        // If form is valid, submit it
        if (isValid && typeof ReliefAPI !== 'undefined') {
            if (formId === 'login-form') {
                handleLogin(email.value, password.value);
            } else if (formId === 'signup-form') {
                const nameInput = form.querySelector('input[name="name"]');
                const name = nameInput ? nameInput.value : '';
                handleSignup(name, email.value, password.value);
            }
        }
    });
}

// Handle login
function handleLogin(email, password) {
    if (typeof ReliefAPI === 'undefined') return;
    
    ReliefAPI.login(email, password)
        .then(user => {
            alert('Login successful!');
            updateAuthUI(user);
            window.location.href = '../index.html';
        })
        .catch(error => {
            alert(error.message || 'Login failed');
        });
}

// Handle signup
function handleSignup(name, email, password) {
    if (typeof ReliefAPI === 'undefined') return;
    
    const userData = {
        name,
        email,
        password,
        joined: new Date().toISOString()
    };
    
    ReliefAPI.signup(userData)
        .then(user => {
            alert('Account created successfully!');
            updateAuthUI(user);
            window.location.href = '../index.html';
        })
        .catch(error => {
            alert(error.message || 'Signup failed');
        });
}

// Handle logout
function handleLogout() {
    if (typeof ReliefAPI === 'undefined') return;
    
    ReliefAPI.logout()
        .then(() => {
            alert('Logged out successfully');
            updateAuthUI(null);
            window.location.href = '../index.html';
        })
        .catch(error => {
            alert(error.message || 'Logout failed');
        });
}

// Initialize form validation when pages load
document.addEventListener('DOMContentLoaded', function() {
    validateForm('login-form');
    validateForm('signup-form');
    validateForm('symptoms-form');
    
    // Add logout event listeners
    document.querySelectorAll('.btn-logout').forEach(btn => {
        btn.addEventListener('click', handleLogout);
    });
});

// Geolocation function
function getLocation() {
    return new Promise((resolve, reject) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                position => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    localStorage.setItem('userLocation', JSON.stringify({ lat, lng }));
                    resolve({ lat, lng });
                },
                error => {
                    console.error('Error getting location:', error);
                    reject(error);
                }
            );
        } else {
            console.error('Geolocation is not supported by this browser.');
            reject(new Error('Geolocation not supported'));
        }
    });
}

// Initialize geolocation on pages that need it
function initLocationServices() {
    if (document.querySelector('.location-based-services')) {
        getLocation().catch(() => {
            // Fallback to default location or prompt user
        });
    }
}

document.addEventListener('DOMContentLoaded', initLocationServices);












document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    
    hamburger.addEventListener('click', function() {
        this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
        navLinks.classList.toggle('active');
    });
    
    // Mobile dropdown functionality
    const dropdownToggles = document.querySelectorAll('.dropdown-toggle');
    
    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            if (window.innerWidth <= 992) {
                e.preventDefault();
                const dropdown = this.closest('.dropdown');
                dropdown.classList.toggle('active');
            }
        });
    });
});