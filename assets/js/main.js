// Splash Screen

const RELIEF_SESSION_STORAGE_KEY = 'relief_auth_sessions';

function getDeviceType() {
    const userAgent = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? 'mobile' : 'desktop';
}

function loadSessions() {
    try {
        return JSON.parse(localStorage.getItem(RELIEF_SESSION_STORAGE_KEY) || '[]');
    } catch (error) {
        console.error('Failed to parse stored sessions:', error);
        return [];
    }
}

function saveSessions(sessions) {
    localStorage.setItem(RELIEF_SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

function getActiveSession() {
    const now = Date.now();
    const validSessions = loadSessions().filter(session => session.expiresAt > now);

    if (validSessions.length === 0) {
        return null;
    }

    const mobileSessions = validSessions.filter(session => session.deviceType === 'mobile');
    const prioritized = mobileSessions.length > 0 ? mobileSessions : validSessions;

    prioritized.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return prioritized[0];
}

function touchActiveSession() {
    const activeSession = getActiveSession();
    if (!activeSession) return null;

    const sessions = loadSessions().map(session => {
        if (session.token === activeSession.token) {
            return { ...session, lastActiveAt: Date.now() };
        }

        return session;
    });

    saveSessions(sessions);
    return activeSession;
}

function clearSessions() {
    localStorage.removeItem(RELIEF_SESSION_STORAGE_KEY);
}

function ensureDashboardActions(user) {
    const navLists = document.querySelectorAll('.navbar-right .nav-links');

    navLists.forEach(nav => {
        if (!nav.querySelector('.user-menu')) {
            const menuItem = document.createElement('li');
            menuItem.className = 'user-menu';
            menuItem.style.display = 'none';
            menuItem.innerHTML = `
                <a href="../pages/dashboard.html" class="btn-dashboard">Dashboard</a>
                <button type="button" class="btn-logout">Logout</button>
            `;
            nav.appendChild(menuItem);
        }

        const userMenu = nav.querySelector('.user-menu');
        const dashboardLink = userMenu?.querySelector('.btn-dashboard');
        if (dashboardLink) {
            dashboardLink.href = window.location.pathname.includes('/pages/') ? 'dashboard.html' : 'pages/dashboard.html';
        }
    });

    document.querySelectorAll('.btn-logout').forEach(btn => {
        btn.removeEventListener('click', handleLogout);
        btn.addEventListener('click', handleLogout);
    });
}

window.ReliefSession = {
    createSession(user) {
        const now = Date.now();
        const session = {
            token: `relief_${Math.random().toString(36).slice(2)}_${now}`,
            user,
            deviceType: getDeviceType(),
            createdAt: now,
            lastActiveAt: now,
            expiresAt: now + (1000 * 60 * 60 * 24 * 30)
        };

        const sessions = loadSessions().filter(item => item.expiresAt > now).slice(-9);
        sessions.push(session);
        saveSessions(sessions);

        return session;
    },
    getCurrentSession() {
        return touchActiveSession();
    },
    clearSessions
};

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

    checkAuthStatus();
    initializeBackToTopButton();
});

function initializeBackToTopButton() {
    if (document.querySelector('.back-to-top-btn')) {
        return;
    }

    const backToTopButton = document.createElement('button');
    backToTopButton.type = 'button';
    backToTopButton.className = 'back-to-top-btn';
    backToTopButton.setAttribute('aria-label', 'Back to top');
    backToTopButton.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    document.body.appendChild(backToTopButton);

    if (!document.getElementById('back-to-top-styles')) {
        const styles = document.createElement('style');
        styles.id = 'back-to-top-styles';
        styles.textContent = `
            .back-to-top-btn {
                position: fixed;
                right: 1.5rem;
                bottom: 1.5rem;
                z-index: 1000;
                width: 3rem;
                height: 3rem;
                border: none;
                border-radius: 50%;
                background: linear-gradient(135deg, #3498db, #1d6fa5);
                color: #fff;
                font-size: 1rem;
                cursor: pointer;
                box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
                opacity: 0;
                visibility: hidden;
                transform: translateY(10px);
                transition: opacity 0.25s ease, transform 0.25s ease, visibility 0.25s ease;
            }

            .back-to-top-btn.is-visible {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            .back-to-top-btn:hover,
            .back-to-top-btn:focus-visible {
                background: linear-gradient(135deg, #2f89c5, #175f90);
                transform: translateY(-2px);
                outline: none;
            }
        `;
        document.head.appendChild(styles);
    }

    const toggleVisibility = () => {
        if (window.scrollY > 300) {
            backToTopButton.classList.add('is-visible');
        } else {
            backToTopButton.classList.remove('is-visible');
        }
    };

    window.addEventListener('scroll', toggleVisibility, { passive: true });
    toggleVisibility();

    backToTopButton.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// Check authentication status and update UI
function checkAuthStatus() {
    const activeSession = window.ReliefSession?.getCurrentSession?.();

    if (activeSession?.user) {
        updateAuthUI(activeSession.user);

        const isAuthPage = /\/(login|signup)\.html$/.test(window.location.pathname);
        if (isAuthPage) {
            window.location.href = 'dashboard.html';
        }

        return;
    }

    if (typeof ReliefAPI === 'undefined') {
        updateAuthUI(null);
        return;
    }

    ReliefAPI.getCurrentUser().then(user => {
        if (user) {
            window.ReliefSession?.createSession?.(user);
        }
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

    ensureDashboardActions(user);

    const userMenuItems = document.querySelectorAll('.user-menu');

    if (user) {
        loginButtons.forEach(btn => btn.style.display = 'none');
        signupButtons.forEach(btn => btn.style.display = 'none');
        userMenuItems.forEach(item => {
            item.style.display = 'flex';
            item.style.gap = '0.5rem';
        });
    } else {
        loginButtons.forEach(btn => btn.style.display = 'block');
        signupButtons.forEach(btn => btn.style.display = 'block');
        userMenuItems.forEach(item => {
            item.style.display = 'none';
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
            window.ReliefSession?.createSession?.(user);
            updateAuthUI(user);
            window.location.href = 'dashboard.html';
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
            window.ReliefSession?.createSession?.(user);
            updateAuthUI(user);
            window.location.href = 'dashboard.html';
        })
        .catch(error => {
            alert(error.message || 'Signup failed');
        });
}

// Handle logout
function handleLogout() {
    const finalizeLogout = () => {
        window.ReliefSession?.clearSessions?.();
        updateAuthUI(null);
        window.location.href = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
    };

    if (typeof ReliefAPI === 'undefined') {
        finalizeLogout();
        return;
    }

    ReliefAPI.logout()
        .then(finalizeLogout)
        .catch(error => {
            console.error('Logout failed:', error);
            finalizeLogout();
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
