/**
 * Relief Assistant: a small rule-based guide (no network, no AI model).
 * routeMessage(text) is pure so it can be tested with node:test.
 * Check order: empty / too long, urgent signs, medical-advice questions,
 * navigation intents, fallback.
 * User text is never stored or logged.
 */
(function (root) {
    'use strict';

    var MAX_LENGTH = 500;

    var LINKS = {
        sos: { label: 'Emergency SOS', href: './ambulances.html#emergency-sos' },
        firstAid: { label: 'First Aid guides', href: './firstaid.html' },
        symptoms: { label: 'Symptom checker', href: './symptoms.html' },
        hospitals: { label: 'Hospitals', href: './hospitals.html' },
        doctors: { label: 'Find doctors', href: './doctors.html' },
        appointments: { label: 'Appointments', href: './appointments.html' },
        pharmacies: { label: 'Pharmacies', href: './pharmacies.html' },
        ambulances: { label: 'Ambulances', href: './ambulances.html' },
        subscription: { label: 'Subscription plans', href: './subscription.html' }
    };

    var MEDICAL_ADVICE = [
        /\b(dose|dosage|overdose|how\s+(much|many)\b.*\b(take|tablets?|pills?|mg|ml)|\d+\s*(mg|ml)\b)/i,
        /\b(should|can|could|may)\s+i\s+(take|use|stop|skip|mix|give)\b/i,
        /\b(what|which)\s+(medicine|medication|drug|tablet|pill|antibiotic)s?\b/i,
        /\bis\s+it\s+safe\s+to\s+(take|use|mix)\b/i,
        /\b(prescribe|prescription\s+for|medicine\s+for|tablet\s+for|treatment\s+for|cure\s+for)\b/i,
        /\b(do\s+i\s+have|am\s+i\s+having|diagnos(e|is)|what\s+(disease|illness|condition)|is\s+it\s+(cancer|diabetes|covid|dengue|malaria|serious))\b/i
    ];

    var NAVIGATION = [
        { re: /\b(first\s*aid|burn|burns|bleeding|cpr|bandage|wound)\b/i, key: 'firstAid',
          text: 'Our First Aid guides cover common situations step by step. For anything severe, call local emergency services first.' },
        { re: /\bambulances?\b/i, key: 'ambulances',
          text: 'The Ambulances page lists ambulance contacts. In an emergency, call local emergency services directly.' },
        { re: /\b(hospitals?|clinics?|nearby|nearest)\b/i, key: 'hospitals',
          text: 'The Hospitals page lists facilities you can look up. Please confirm availability by phone before travelling.' },
        { re: /\b(pharmacy|pharmacies|chemist|buy\s+medicine)\b/i, key: 'pharmacies',
          text: 'The Pharmacies page lists pharmacies you can look up. Please confirm stock and opening hours by phone.' },
        { re: /\b(appointments?|book|booking)\b/i, key: 'appointments',
          text: 'You can open the Appointments page to look at booking options. Availability is not guaranteed.' },
        { re: /\b(doctors?|physicians?|specialists?|consult\w*)\b/i, key: 'doctors',
          text: 'The Find Doctors page lets you browse doctors by specialty.' },
        { re: /\b(subscriptions?|plans?|pricing|upgrade)\b/i, key: 'subscription',
          text: 'You can compare plans on the Subscription page.' },
        { re: /\b(symptoms?|sick|unwell|fever|headache|cough|pain)\b/i, key: 'symptoms',
          text: 'The Symptom checker gives general health information. It is not a diagnosis.' }
    ];

    function reply(type, text, linkKeys, extra) {
        var out = {
            type: type,
            text: text,
            links: (linkKeys || []).map(function (k) { return LINKS[k]; }),
            alert: false
        };
        if (extra) {
            Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
        }
        return out;
    }

    function getDetector(options) {
        if (options && typeof options.detect === 'function') return options.detect;
        var s = root.SymptomSafety;
        if (!s && typeof require === 'function') {
            try { s = require('./symptoms.js'); } catch (e) { s = null; }
        }
        if (!s || typeof s.detectEmergencySigns !== 'function') {
            throw new Error('Emergency detection is unavailable');
        }
        return s.detectEmergencySigns;
    }

    function routeMessage(text, options) {
        var input = String(text == null ? '' : text).trim();

        if (!input) {
            return reply('empty', 'Please type a question first, for example "Find nearby hospitals".');
        }
        if (input.length > MAX_LENGTH) {
            return reply('too_long', 'That message is too long for me. Please keep it under ' + MAX_LENGTH + ' characters. If this is an emergency, call local emergency services now.', ['sos']);
        }

        var detect = getDetector(options);
        var found = detect({ symptomsText: input });
        if (found && found.isEmergency) {
            return reply('urgent',
                'What you describe may be an emergency. Please call your local emergency services now (for example 112 in India, 911 in the US, 999 in the UK) or ask someone nearby to help you. Do not wait for a reply here.',
                ['sos', 'firstAid'], { alert: true });
        }

        for (var i = 0; i < MEDICAL_ADVICE.length; i++) {
            if (MEDICAL_ADVICE[i].test(input)) {
                return reply('medical_advice',
                    'I can\'t give medical advice, doses or a diagnosis. Please speak to a doctor or pharmacist. These pages offer general information only.',
                    ['symptoms', 'firstAid']);
            }
        }

        for (var j = 0; j < NAVIGATION.length; j++) {
            if (NAVIGATION[j].re.test(input)) {
                return reply('navigation', NAVIGATION[j].text, [NAVIGATION[j].key], { intent: NAVIGATION[j].key });
            }
        }

        return reply('fallback', 'I can point you to hospitals, doctors, pharmacies, first aid, the symptom checker and subscription plans. Try asking: "Find nearby hospitals".',
            ['hospitals', 'doctors', 'firstAid', 'symptoms']);
    }

    // Never throws: any failure becomes a safe message the page can retry.
    function safeRoute(text, options) {
        try {
            return routeMessage(text, options);
        } catch (e) {
            return reply('error', 'Sorry, something went wrong on my side. You can try again or clear the chat. If this is an emergency, call local emergency services now.', ['sos'], { retry: true });
        }
    }

    var api = { routeMessage: routeMessage, safeRoute: safeRoute, MAX_LENGTH: MAX_LENGTH, LINKS: LINKS, NAVIGATION: NAVIGATION };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.ReliefAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
