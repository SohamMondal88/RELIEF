document.addEventListener('DOMContentLoaded', function() {
    var Request = window.ReliefAppointmentRequest;

    // The doctor is chosen on the doctors page and passed through localStorage.
    var selectedDoctor = null;
    try {
        selectedDoctor = JSON.parse(localStorage.getItem('selectedDoctor'));
    } catch (e) {
        selectedDoctor = null;
    }

    // DOM elements
    var doctorSummary = document.querySelector('.doctor-summary');
    var appointmentSummary = document.querySelector('.appointment-summary');
    var steps = document.querySelectorAll('.form-step');
    var stepIndicators = document.querySelectorAll('.booking-steps .step');
    var form = document.getElementById('patient-form');
    var dateInput = document.getElementById('preferred-date');
    var submitButton = document.querySelector('.btn-confirm');
    var statusRegion = document.getElementById('request-status');
    var currentStep = 0;
    var sending = false;
    var lastErrorCount = 0;
    var FormErrors = window.ReliefFormErrors;

    // Where each validated field lives on the page: the element to focus,
    // the element that shows the message, and the step it belongs to.
    var FIELDS = {
        doctor: { focus: 'doctor-error', error: 'doctor-error', step: 0 },
        date: { focus: 'preferred-date', error: 'preferred-date-error', step: 1 },
        timeWindow: { focus: 'window-morning', error: 'time-window-error', step: 1 },
        name: { focus: 'patient-name', error: 'patient-name-error', step: 2 },
        email: { focus: 'patient-email', error: 'patient-email-error', step: 2 },
        phone: { focus: 'patient-phone', error: 'patient-phone-error', step: 2 },
        notes: { focus: 'patient-notes', error: 'patient-notes-error', step: 2 },
        consent: { focus: 'patient-consent', error: 'patient-consent-error', step: 2 }
    };

    function addParagraph(parent, className, text) {
        var el = document.createElement('p');
        el.className = className;
        el.textContent = text;
        parent.appendChild(el);
        return el;
    }

    // Display doctor information (textContent only, the stored value is untrusted)
    function displayDoctorInfo() {
        doctorSummary.textContent = '';
        if (!selectedDoctor) {
            var msg = document.getElementById('doctor-error');
            msg.hidden = false;
            msg.textContent = '';
            msg.appendChild(document.createTextNode('No doctor selected. '));
            var link = document.createElement('a');
            link.href = '../pages/doctors.html';
            link.textContent = 'Choose a doctor first.';
            msg.appendChild(link);
            document.querySelectorAll('.btn-next').forEach(function(b) { b.disabled = true; });
            return;
        }
        var image = document.createElement('div');
        image.className = 'doctor-image';
        image.setAttribute('aria-hidden', 'true');
        if (selectedDoctor.image) {
            image.style.backgroundImage = 'url("' + String(selectedDoctor.image).replace(/["\\\n\r]/g, '') + '")';
        }
        var details = document.createElement('div');
        details.className = 'doctor-details';
        var name = document.createElement('h3');
        name.textContent = selectedDoctor.name || '';
        details.appendChild(name);
        addParagraph(details, 'doctor-specialty', selectedDoctor.specialty || '');
        addParagraph(details, 'doctor-location', selectedDoctor.location || '');
        doctorSummary.appendChild(image);
        doctorSummary.appendChild(details);
    }

    function showStep(stepIndex) {
        steps.forEach(function(step, index) {
            step.classList.toggle('active', index === stepIndex);
        });
        stepIndicators.forEach(function(indicator, index) {
            indicator.classList.toggle('active', index === stepIndex);
            indicator.classList.toggle('completed', index < stepIndex);
        });
        if (stepIndex === 2) {
            updateAppointmentSummary();
        }
    }

    function selectedWindow() {
        var checked = document.querySelector('input[name="time-window"]:checked');
        return checked ? checked.value : '';
    }

    function addSummaryRow(label, value) {
        var row = document.createElement('div');
        row.className = 'summary-item';
        var l = document.createElement('span');
        l.className = 'summary-label';
        l.textContent = label;
        var v = document.createElement('span');
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        appointmentSummary.appendChild(row);
    }

    function updateAppointmentSummary() {
        appointmentSummary.textContent = '';
        var date = Request.parseDate(dateInput.value);
        var windowInfo = Request.TIME_WINDOWS[selectedWindow()];
        addSummaryRow('Doctor:', selectedDoctor.name || '');
        addSummaryRow('Specialty:', selectedDoctor.specialty || '');
        addSummaryRow('Preferred date:', date ? date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '');
        addSummaryRow('Preferred time:', windowInfo ? windowInfo.label : '');
        addSummaryRow('Location:', selectedDoctor.location || '');
    }

    function readInput() {
        return {
            doctor: selectedDoctor,
            date: dateInput.value,
            timeWindow: selectedWindow(),
            name: document.getElementById('patient-name').value,
            email: document.getElementById('patient-email').value,
            phone: document.getElementById('patient-phone').value,
            notes: document.getElementById('patient-notes').value,
            consent: document.getElementById('patient-consent').checked
        };
    }

    // Field settings for the shared error helper (doctor is shown on its own panel).
    var ERROR_FIELDS = {};
    Object.keys(FIELDS).forEach(function(key) {
        if (key === 'doctor') return;
        ERROR_FIELDS[key] = {
            focusId: FIELDS[key].focus,
            errorId: FIELDS[key].error,
            groupId: key === 'timeWindow' ? 'time-window-group' : undefined
        };
    });
    var SUMMARY_ID = 'appointment-error-summary';

    function clearErrors() {
        FormErrors.clearErrors(document, { fields: ERROR_FIELDS, summaryId: SUMMARY_ID });
    }

    // Shows inline errors and a summary for the given keys. Returns the first key with a problem.
    // The caller moves focus (see focusErrors) because a field may be on another step.
    function showErrors(errors, keys) {
        var subset = {};
        keys.forEach(function(key) {
            if (key !== 'doctor' && errors[key]) subset[key] = errors[key];
        });
        var shown = FormErrors.applyErrors(document, subset, {
            fields: ERROR_FIELDS,
            order: keys,
            summaryId: SUMMARY_ID,
            title: 'Please fix the following',
            focus: false
        });
        lastErrorCount = shown.count;
        return shown.first;
    }

    // One problem: go to its field. Several: go to the summary, which links to each field.
    function focusErrors(first) {
        var summary = document.getElementById(SUMMARY_ID);
        if (lastErrorCount > 1 && summary) {
            summary.focus();
        } else if (first) {
            document.getElementById(FIELDS[first].focus).focus();
        }
    }

    // A summary link may point at a field on another step, so show that step first.
    FormErrors.bindSummaryLinks(document, SUMMARY_ID, function(fieldId) {
        Object.keys(FIELDS).forEach(function(key) {
            if (FIELDS[key].focus === fieldId && FIELDS[key].step !== currentStep) {
                currentStep = FIELDS[key].step;
                showStep(currentStep);
            }
        });
    });

    function setStatus(message, isError) {
        statusRegion.textContent = message;
        statusRegion.classList.toggle('is-error', !!isError);
        statusRegion.hidden = !message;
    }

    function setSending(value) {
        sending = value;
        submitButton.disabled = value;
        submitButton.setAttribute('aria-busy', value ? 'true' : 'false');
        submitButton.textContent = value ? 'Sending request...' : 'Submit Request';
    }

    function showSuccess(request) {
        form.hidden = true;
        appointmentSummary.hidden = true;
        document.querySelectorAll('.form-step[data-step="3"] .form-actions').forEach(function(a) { a.hidden = true; });
        var box = document.getElementById('request-success');
        box.hidden = false;
        box.textContent = '';
        var title = document.createElement('h3');
        title.textContent = 'Request submitted, not yet confirmed';
        title.tabIndex = -1;
        box.appendChild(title);
        addParagraph(box, 'request-success-text',
            'Your request for ' + request.doctorName + ' has been submitted. It is not a confirmed appointment yet. ' +
            'The provider will confirm the actual date and time with you by email or phone.');
        addParagraph(box, 'request-success-text',
            'Reference: ' + request.id + '. If this is an emergency, do not wait. Call your local emergency number.');
        title.focus();
    }

    function submitRequest(event) {
        event.preventDefault();
        if (sending) return;
        setStatus('', false);
        var input = readInput();
        var result = Request.validateRequest(input);
        if (!result.valid) {
            var first = showErrors(result.errors, Request.FIELD_ORDER);
            // A field from an earlier step lives on another panel, so go back to it.
            if (first && FIELDS[first].step !== currentStep) {
                currentStep = FIELDS[first].step;
                showStep(currentStep);
            }
            focusErrors(first);
            return;
        }
        clearErrors();
        setSending(true);
        var request = Request.buildRequest(input);
        var saved = Request.saveRequest(window.localStorage, request);
        if (saved.ok) {
            showSuccess(request);
            return;
        }
        setSending(false);
        if (saved.reason === 'duplicate') {
            setStatus('You already have an open request for this doctor, date and time window. Wait for the provider to contact you or choose a different date.', true);
        } else {
            setStatus('Your request could not be saved because browser storage is unavailable or full. Nothing was submitted. Free up space or allow storage for this site, then try again.', true);
        }
    }

    // Initialize the page
    var today = new Date();
    dateInput.min = Request.toDateString(today);
    dateInput.max = Request.toDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + Request.MAX_DAYS_AHEAD));
    displayDoctorInfo();
    showStep(currentStep);

    // Step 2 only needs a date and a time window before moving on.
    document.querySelectorAll('.btn-next').forEach(function(button) {
        button.addEventListener('click', function() {
            if (currentStep === 1) {
                var stepKeys = ['date', 'timeWindow'];
                var result = Request.validateRequest(readInput());
                if (stepKeys.some(function(k) { return result.errors[k]; })) {
                    focusErrors(showErrors(result.errors, stepKeys));
                    return;
                }
                clearErrors();
            }
            if (currentStep < steps.length - 1) {
                currentStep++;
                showStep(currentStep);
            }
        });
    });

    document.querySelectorAll('.btn-prev').forEach(function(button) {
        button.addEventListener('click', function() {
            if (currentStep > 0) {
                currentStep--;
                showStep(currentStep);
            }
        });
    });

    form.addEventListener('submit', submitRequest);
});

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
