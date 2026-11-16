// Contact form: validation and error handling.
// The rules live in contact-send.js (ReliefContactSend.validate) and the way errors are shown
// lives in form-errors.js (ReliefFormErrors), the same helper the appointment and reminder forms use.

const contactForm = document.getElementById('contactForm');
const contactGuard = contactForm && window.ReliefFormGuard
    ? window.ReliefFormGuard.createGuard('contact', { maxAttempts: 3, windowMs: 60 * 1000, minFillMs: 1500 })
    : null;

// Each field points at its own message element, and all of them report into one summary.
const CONTACT_FIELDS = {
    name: { focusId: 'name', errorId: 'name-error' },
    email: { focusId: 'email', errorId: 'email-error' },
    message: { focusId: 'message', errorId: 'message-error' },
    consent: { focusId: 'consent', errorId: 'consent-error' }
};
const CONTACT_ERROR_OPTIONS = {
    fields: CONTACT_FIELDS,
    order: ['name', 'email', 'message', 'consent'],
    summaryId: 'contact-error-summary',
    title: 'Please fix the following'
};

if (contactForm) {
    window.ReliefFormGuard?.attachHoneypot(contactForm);

    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        clearSendFailure();
        window.ReliefFormGuard?.showGuardMessage(contactForm, '');

        // One problem sends focus to its field, several send it to the summary that links to each field.
        // What the person typed is never cleared.
        const errors = window.ReliefContactSend.validate(readContactFields());
        if (Object.keys(errors).length > 0) {
            window.ReliefFormErrors.applyErrors(document, errors, CONTACT_ERROR_OPTIONS);
            return;
        }

        window.ReliefFormErrors.clearErrors(document, CONTACT_ERROR_OPTIONS);
        submitContactForm();
    });

    // A field is checked when the person leaves it, and its message goes away as soon as they edit it.
    ['name', 'email', 'message'].forEach(function(key) {
        document.getElementById(key).addEventListener('blur', function() { checkContactField(key); });
    });
    document.getElementById('consent').addEventListener('change', function() { checkContactField('consent'); });
    window.ReliefFormErrors.bindFieldClearing(document, CONTACT_ERROR_OPTIONS);
    window.ReliefFormErrors.bindSummaryLinks(document, CONTACT_ERROR_OPTIONS.summaryId);
}

function checkContactField(key) {
    const FE = window.ReliefFormErrors;
    const message = window.ReliefContactSend.validate(readContactFields())[key];
    if (message) FE.showFieldError(document, CONTACT_FIELDS[key], message);
    else FE.clearFieldError(document, key, CONTACT_ERROR_OPTIONS);
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
    // "Too many attempts" and similar are alerts too. Focus goes there when there is no send failure box.
    const guardBox = !failedToSend && guardText ? contactForm.querySelector('.form-guard-message') : null;
    if (guardBox) { guardBox.tabIndex = -1; guardBox.focus(); }
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
    successMessage.tabIndex = -1;
    successMessage.innerHTML = `
        <div class="success-content">
            <i class="fas fa-check-circle"></i>
            <h3>Message sent</h3>
            <p>Thank you. Your message was delivered to the RELIEF team.</p>
        </div>
    `;
    contactForm.replaceWith(successMessage);
    // The button that had focus is gone, so focus goes to the confirmation instead of falling to the page top.
    successMessage.focus();
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
    box.tabIndex = -1;

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
    // The failed send disabled the button, which drops focus, so put it on the message.
    box.focus();
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
