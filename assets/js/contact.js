// Contact Form Validation
const contactForm = document.getElementById('contactForm');
const contactGuard = contactForm && window.ReliefFormGuard
    ? window.ReliefFormGuard.createGuard('contact', { maxAttempts: 3, windowMs: 60 * 1000, minFillMs: 1500 })
    : null;

if (contactForm) {
    window.ReliefFormGuard?.attachHoneypot(contactForm);

    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // Reset previous error states
        resetErrors();

        // Validate form
        const isValid = validateForm();

        if (isValid) {
            submitContactForm();
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

function readContactFields() {
    return {
        name: contactForm.elements['name'].value,
        email: contactForm.elements['email'].value,
        subject: contactForm.elements['subject'].value,
        message: contactForm.elements['message'].value,
        consent: contactForm.elements['consent'].checked
    };
}

async function submitContactForm() {
    clearSendFailure();

    // The guard (rate limit, double submit, honeypot) still decides whether an attempt may go out.
    // sendContactMessage() throws when the message did not really arrive, which the guard reports as "failed".
    const outcome = contactGuard
        ? await contactGuard.run(() => sendContactMessage(), { honeypot: contactForm.elements['website']?.value })
        : await sendContactMessage().then(() => ({ ok: true }), (error) => ({ ok: false, reason: 'failed', error: error, message: error.message }));

    if (outcome.ok) return;

    // A blocked or failed attempt keeps the user's text and explains how to recover.
    const failedToSend = outcome.reason === 'failed' && outcome.error && outcome.error.kind;
    if (failedToSend) showSendFailure(outcome.error.message);
    // The guard message (for example "Too many attempts") is shown when it is the reason, or on top of a failure.
    const guardText = !failedToSend || outcome.retryAfterMs > 0 ? outcome.message : '';
    if (contactGuard) window.ReliefFormGuard.showGuardMessage(contactForm, guardText);
}

// Sends the message through ReliefAPI. Shows the thank-you text only after the backend confirmed it.
async function sendContactMessage() {
    const submitButton = contactForm.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
        await window.ReliefContactSend.send(window.ReliefAPI, readContactFields());
    } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
        throw error;
    }

    const successMessage = document.createElement('div');
    successMessage.className = 'form-success';
    successMessage.setAttribute('role', 'status');
    successMessage.innerHTML = `
        <div class="success-content">
            <i class="fas fa-check-circle"></i>
            <h3>Message sent</h3>
            <p>Thank you. Your message was delivered to the RELIEF team.</p>
        </div>
    `;
    contactForm.replaceWith(successMessage);
}

// The contact details already on this page, so the fallback never invents an address.
function contactDetail(selector) {
    const link = document.querySelector(selector);
    if (!link) return null;
    return { value: link.getAttribute('href').replace(/^(mailto|tel):/, ''), text: link.textContent.trim() };
}

function clearSendFailure() {
    const box = contactForm.querySelector('.contact-send-failure');
    if (box) box.remove();
}

function showSendFailure(message) {
    clearSendFailure();
    const email = contactDetail('a.contact-link[href^="mailto:"]');
    const phone = contactDetail('a.contact-link[href^="tel:"]');

    const box = document.createElement('div');
    box.className = 'contact-send-failure';
    box.setAttribute('role', 'alert');

    const text = document.createElement('p');
    text.textContent = message + ' What you typed is still in the form.';
    box.appendChild(text);

    if (email || phone) {
        const options = document.createElement('p');
        options.append('You can reach the team another way: ');
        if (email) {
            const mail = document.createElement('a');
            mail.href = window.ReliefContactSend.mailtoHref(email.value, readContactFields());
            mail.textContent = 'open an email with your message to ' + email.text;
            options.appendChild(mail);
        }
        if (email && phone) options.append(' or call ');
        else if (phone) options.append('call ');
        if (phone) {
            const call = document.createElement('a');
            call.href = 'tel:' + phone.value;
            call.textContent = phone.text;
            options.appendChild(call);
        }
        options.append('.');
        box.appendChild(options);
    }

    const emergency = document.createElement('p');
    emergency.textContent = 'This form is not for emergencies. In an emergency, call your local emergency number.';
    box.appendChild(emergency);

    const submit = contactForm.querySelector('button[type="submit"]');
    submit.parentNode.insertBefore(box, submit);
    box.scrollIntoView({ block: 'nearest' });
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
    // Secondary safety check: ensure hamburger exists and is not already initialized
    const hamburger = document.querySelector('.hamburger');
    if (!hamburger || hamburger.dataset.navInitialized === 'true') {
        return;
    }
    const navLinks = document.querySelector('.nav-links');
    if (navLinks) {
        hamburger.addEventListener('click', function() {
            this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
            navLinks.classList.toggle('active');
        });
    }
});
