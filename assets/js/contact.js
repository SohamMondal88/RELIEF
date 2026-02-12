// Contact Form Validation
const contactForm = document.getElementById('contactForm');
if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // Reset previous error states
        resetErrors();

        // Validate form
        const isValid = validateForm();

        if (isValid) {
            // Form is valid - simulate submission
            simulateFormSubmission();
        }
    });

    // Real-time validation for fields
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const messageInput = document.getElementById('message');
    const consentCheckbox = document.getElementById('consent');

    nameInput.addEventListener('blur', validateName);
    emailInput.addEventListener('blur', validateEmail);
    messageInput.addEventListener('blur', validateMessage);
    consentCheckbox.addEventListener('change', validateConsent);
}

function validateForm() {
    let isValid = true;

    // Validate each field
    isValid = validateName() && isValid;
    isValid = validateEmail() && isValid;
    isValid = validateMessage() && isValid;
    isValid = validateConsent() && isValid;

    return isValid;
}

function validateName() {
    const nameInput = document.getElementById('name');
    const errorElement = nameInput.nextElementSibling;
    const nameValue = nameInput.value.trim();

    if (nameValue === '') {
        showError(nameInput, errorElement, 'Please enter your name');
        return false;
    }

    if (nameValue.length < 2) {
        showError(nameInput, errorElement, 'Name must be at least 2 characters');
        return false;
    }

    clearError(nameInput, errorElement);
    return true;
}

function validateEmail() {
    const emailInput = document.getElementById('email');
    const errorElement = emailInput.nextElementSibling;
    const emailValue = emailInput.value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (emailValue === '') {
        showError(emailInput, errorElement, 'Please enter your email');
        return false;
    }

    if (!emailRegex.test(emailValue)) {
        showError(emailInput, errorElement, 'Please enter a valid email address');
        return false;
    }

    clearError(emailInput, errorElement);
    return true;
}

function validateMessage() {
    const messageInput = document.getElementById('message');
    const errorElement = messageInput.nextElementSibling;
    const messageValue = messageInput.value.trim();

    if (messageValue === '') {
        showError(messageInput, errorElement, 'Please enter your message');
        return false;
    }

    if (messageValue.length < 10) {
        showError(messageInput, errorElement, 'Message must be at least 10 characters');
        return false;
    }

    clearError(messageInput, errorElement);
    return true;
}

function validateConsent() {
    const consentCheckbox = document.getElementById('consent');
    const errorElement = consentCheckbox.nextElementSibling.nextElementSibling;

    if (!consentCheckbox.checked) {
        showError(consentCheckbox, errorElement, 'You must agree to the privacy policy');
        return false;
    }

    clearError(consentCheckbox, errorElement);
    return true;
}

function showError(input, errorElement, message) {
    input.style.borderColor = 'var(--danger-color)';
    errorElement.textContent = message;
}

function clearError(input, errorElement) {
    input.style.borderColor = '#ddd';
    errorElement.textContent = '';
}

function resetErrors() {
    const errorMessages = document.querySelectorAll('.error-message');
    errorMessages.forEach(el => el.textContent = '');

    const inputs = document.querySelectorAll('.form-group input, .form-group textarea, .form-group select');
    inputs.forEach(input => input.style.borderColor = '#ddd');
}

function simulateFormSubmission() {
    const submitButton = contactForm.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    // Show loading state
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    // Simulate API call
    setTimeout(() => {
        // Show success message
        const successMessage = document.createElement('div');
        successMessage.className = 'form-success';
        successMessage.innerHTML = `
            <div class="success-content">
                <i class="fas fa-check-circle"></i>
                <h3>Thank you for your message!</h3>
                <p>We've received your inquiry and will respond within 24 hours.</p>
            </div>
        `;

        contactForm.replaceWith(successMessage);

        // Reset form (in a real app, this would happen after actual submission)
        contactForm.reset();
    }, 1500);
}

// FAQ Accordion Functionality
const faqItems = document.querySelectorAll('.faq-item');
if (faqItems) {
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');

        question.addEventListener('click', () => {
            // Close all other items
            faqItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });

            // Toggle current item
            item.classList.toggle('active');
        });
    });

    // Open first FAQ item by default
    if (faqItems.length > 0) {
        faqItems[0].classList.add('active');
    }
}

// Initialize Google Map
function initMap() {
    // This function would be called by the Google Maps API
    // In this example, we're using an embedded iframe instead
    // For actual implementation, you would use the Google Maps JavaScript API
}

// Load Google Maps API (commented out - uncomment and add your API key for real implementation)
/*
function loadGoogleMaps() {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initMap`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

window.addEventListener('load', loadGoogleMaps);
*/












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
