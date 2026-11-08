/**
 * RELIEF - Medically Cautious Symptom Information Flow
 * Implementation of GitHub Issue #20:
 * - Limited, plain-language questions
 * - Prominent emergency and warning-sign guidance
 * - Regional emergency calling options (112, 911, 999, local services)
 * - Negation-aware and variation-aware emergency detection
 * - Explanation of uncertainty and encouragement of professional assessment
 * - Avoidance of unsupported medical diagnoses and prescription recommendations
 * - Tracking reviewed medical sources, review dates, and pre-production clinical review notice
 */

// 1. Tracked Medical References & Catalog of Emergency Warning Signs
const MEDICAL_SOURCES = [
    {
        organization: 'Centers for Disease Control and Prevention (CDC)',
        title: 'When to Seek Emergency Medical Attention & Respiratory Illness Symptoms',
        url: 'https://www.cdc.gov/respiratory-viruses/symptoms/index.html',
        dateReviewed: '2026-10-18',
        lastUpdatedBySource: '2024-03-01',
        status: 'Verified',
        clinicalStatus: 'Awaiting Institutional Clinical Validation'
    },
    {
        organization: 'Centers for Disease Control and Prevention (CDC)',
        title: 'Signs and Symptoms of Stroke (FAST)',
        url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
        dateReviewed: '2026-10-18',
        lastUpdatedBySource: '2024-05-15',
        status: 'Verified',
        clinicalStatus: 'Awaiting Institutional Clinical Validation'
    },
    {
        organization: 'National Health Service (NHS, UK)',
        title: 'When to call 999: Life-threatening emergencies',
        url: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-call-999/',
        dateReviewed: '2026-10-18',
        lastUpdatedBySource: '2024-01-15',
        status: 'Verified',
        clinicalStatus: 'Awaiting Institutional Clinical Validation'
    },
    {
        organization: 'World Health Organization (WHO)',
        title: 'Clinical Emergency Care and Severe Illness Warning Signs',
        url: 'https://www.who.int/teams/integrated-health-services/clinical-services-and-systems/emergency-care',
        dateReviewed: '2026-10-18',
        lastUpdatedBySource: '2023-11-20',
        status: 'Verified',
        clinicalStatus: 'Awaiting Institutional Clinical Validation'
    },
    {
        organization: 'American Heart Association (AHA)',
        title: 'Warning Signs of a Heart Attack',
        url: 'https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack',
        dateReviewed: '2026-10-18',
        lastUpdatedBySource: '2023-08-10',
        status: 'Verified',
        clinicalStatus: 'Awaiting Institutional Clinical Validation'
    }
];

const EMERGENCY_SIGNS_CATALOG = {
    chest_pain: {
        id: 'chest_pain',
        label: 'Severe chest pain, pressure, tightness, or squeezing',
        reason: 'Reported severe chest pain, pressure, or tightness (potential acute cardiac or pulmonary emergency)'
    },
    breathing_difficulty: {
        id: 'breathing_difficulty',
        label: 'Severe shortness of breath or struggling to breathe',
        reason: 'Reported severe difficulty breathing or shortness of breath (potential acute respiratory distress)'
    },
    stroke_symptoms: {
        id: 'stroke_symptoms',
        label: 'Sudden facial droop, arm weakness, or slurred speech (Signs of stroke)',
        reason: 'Reported sudden neurological signs such as facial droop, one-sided weakness, or speech impairment (potential stroke)'
    },
    severe_headache_confusion: {
        id: 'severe_headache_confusion',
        label: 'Sudden, unusually severe headache or sudden confusion',
        reason: 'Reported sudden, unusually severe headache or sudden confusion (potential acute neurological event)'
    },
    severe_bleeding: {
        id: 'severe_bleeding',
        label: 'Uncontrollable bleeding or coughing/vomiting blood',
        reason: 'Reported uncontrollable bleeding or blood in cough/vomit (potential acute hemorrhage)'
    },
    fainting_unconscious: {
        id: 'fainting_unconscious',
        label: 'Loss of consciousness, fainting, or inability to wake up',
        reason: 'Reported loss of consciousness, fainting, collapse, or blacking out'
    },
    severe_allergy: {
        id: 'severe_allergy',
        label: 'Sudden severe swelling of face, lips, tongue, or throat (Anaphylaxis)',
        reason: 'Reported acute severe swelling of the airway, tongue, or throat (potential severe allergic reaction / anaphylaxis)'
    }
};

const EMERGENCY_KEYWORD_PATTERNS = [
    {
        pattern: /\b(chest\s*(pain|pressure|tightness|heaviness|squeezing|discomfort)|(pain|pressure|tightness|heaviness|squeezing|discomfort)\s+in\s+(my\s+|the\s+)?chest|heart\s*attack|angina)\b/i,
        reason: 'Mentioned chest pain, chest tightness, or suspected heart attack'
    },
    {
        pattern: /\b(shortness\s*of\s*breath|difficulty\s*breath(ing)?|struggling\s*to\s*breathe?|(can'?t|cannot|unable\s*to|hard\s*to|trouble)\s*(to\s+)?breath(e|ing)?|gasping(\s*for\s*(air|breath))?|choking|breathless(ness)?|blue\s*(lips|face|skin|fingers)|(lips|face|skin)\s*(turn(ed|ing)?\s*)?blue)\b/i,
        reason: 'Mentioned severe breathing difficulty, choking, or shortness of breath'
    },
    {
        pattern: /\b(stroke|face\s*droop(ing)?|facial\s*droop(ing)?|slurred\s*speech|slurring\s*(my\s+)?words|loss\s*of\s*speech|(can'?t|cannot|unable\s*to)\s*speak|(one\s*side(d)?\s*(weakness|numbness|paralysis))|((weakness|numbness|paralysis)\s+(in|on)\s+(one|my)\s+side)|facial\s*paralysis)\b/i,
        reason: 'Mentioned signs associated with stroke or sudden neurological deficit'
    },
    {
        pattern: /\b(seizure(s)?|convulsion(s)?|convulsing|epileptic\s*fit)\b/i,
        reason: 'Mentioned seizure, convulsions, or uncontrollable shaking'
    },
    {
        pattern: /\b(worst\s*headache|thunderclap\s*headache|sudden\s*severe\s*headache|sudden\s*explosive\s*headache)\b/i,
        reason: 'Mentioned a sudden, extraordinarily severe headache'
    },
    {
        pattern: /\b(coughing\s*(up\s*)?blood|vomiting\s*blood|spitting\s*blood|(uncontrolled|uncontrollable|severe|heavy)\s*bleed(ing)?|hemorrhage|haemorrhage)\b/i,
        reason: 'Mentioned heavy or uncontrollable bleeding, or coughing/vomiting blood'
    },
    {
        pattern: /\b(passed\s*out|fainted|fainting|blacked\s*out|blacking\s*out|collapsed|collapsing|loss\s*of\s*consciousness|unconscious|unresponsive|cannot\s*wake)\b/i,
        reason: 'Mentioned fainting, collapse, blacking out, or loss of consciousness'
    },
    {
        pattern: /\b(anaphylaxis|anaphylactic|throat\s*(is\s*)?closing(\s*up)?|swollen\s*(tongue|throat|lips|airway)|swelling\s+in\s+(my\s+)?(throat|tongue|airway)|trouble\s*swallowing\s*sudden)\b/i,
        reason: 'Mentioned signs of a severe allergic reaction (anaphylaxis)'
    }
];

// 2. Pure Safety Evaluation Logic
/**
 * Determines whether a matched phrase index in a sentence is preceded by a negation word,
 * respecting clause boundaries and contrastive conjunctions.
 *
 * @param {string} fullText - The full user input text.
 * @param {number} matchIndex - The character index where the matched phrase begins.
 * @returns {boolean} True if the phrase is negated; false if active.
 */
function isMatchNegated(fullText, matchIndex) {
    if (!fullText || matchIndex <= 0) return false;

    // Look back up to 60 characters before the match
    const windowStart = Math.max(0, matchIndex - 60);
    const prefix = fullText.slice(windowStart, matchIndex).toLowerCase();

    // Check for negation keywords (global search to capture the closest negation token)
    const negationRegex = /\b(no|not|without|denies|denying|never|neither|nor|ruled\s*out|negative\s*for|free\s*of)\b/gi;
    const matches = Array.from(prefix.matchAll(negationRegex));
    if (matches.length === 0) {
        return false;
    }

    // Inspect the closest negation keyword preceding the match
    const lastMatch = matches[matches.length - 1];
    const lastNegationIndex = lastMatch.index;
    const afterNegation = prefix.slice(lastNegationIndex + lastMatch[0].length);

    // If a clause boundary or contrastive conjunction exists between the negation and the term,
    // the negation scope is terminated (e.g. "no fever, but severe chest pain" -> chest pain is NOT negated).
    const boundaryRegex = /\b(but|however|although|except|yet|still)\b|[,.;:!?]/i;
    if (boundaryRegex.test(afterNegation)) {
        return false;
    }

    return true;
}

/**
 * Detects whether any emergency warning signs are present through structured choices or text patterns.
 * Inspects all occurrences and avoids false positives from negated phrases.
 *
 * @param {Object} params
 * @param {string} [params.symptomsText]
 * @param {string[]} [params.selectedSigns]
 * @returns {{ isEmergency: boolean, reasons: string[] }}
 */
function detectEmergencySigns({ symptomsText = '', selectedSigns = [] } = {}) {
    const reasons = [];

    // Check structured selections (direct affirmative intent from user)
    if (Array.isArray(selectedSigns)) {
        selectedSigns.forEach(signId => {
            if (EMERGENCY_SIGNS_CATALOG[signId]) {
                reasons.push(EMERGENCY_SIGNS_CATALOG[signId].reason);
            }
        });
    }

    // Check free-text keywords with negation and variation detection
    const text = String(symptomsText || '').trim();
    if (text) {
        EMERGENCY_KEYWORD_PATTERNS.forEach(({ pattern, reason }) => {
            const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
            const globalRegex = new RegExp(pattern.source, flags);
            let match;
            while ((match = globalRegex.exec(text)) !== null) {
                // If this occurrence is NOT negated, record the emergency reason
                if (!isMatchNegated(text, match.index)) {
                    if (!reasons.includes(reason)) {
                        reasons.push(reason);
                    }
                    break;
                }
            }
        });
    }

    return {
        isEmergency: reasons.length > 0,
        reasons
    };
}

/**
 * Evaluates symptoms, inputs, and safety constraints.
 * Implements medically cautious guidance:
 * - Deterministic safety priority over routine care
 * - Non-diagnostic wording
 * - No prescription recommendations
 * - Safe handling of incomplete answers
 * - Explicit uncertainty communication
 * - Regionally appropriate emergency routing
 *
 * @param {Object} input
 * @param {string} [input.symptomsText]
 * @param {string[]} [input.emergencySigns]
 * @param {string} [input.duration]
 * @param {string} [input.severity]
 * @param {string} [input.additionalInfo]
 * @param {string} [input.medications]
 * @returns {Object}
 */
function evaluateSymptomSafety({
    symptomsText = '',
    emergencySigns = [],
    duration = 'unspecified',
    severity = 'unspecified',
    additionalInfo = '',
    medications = ''
} = {}) {
    const text = String(symptomsText || '').trim().toLowerCase();
    const emergencyEval = detectEmergencySigns({ symptomsText: text, selectedSigns: emergencySigns });

    const missingInformation = [];
    if (!duration || duration === 'unspecified') {
        missingInformation.push('Duration of symptoms was not provided.');
    }
    if (!severity || severity === 'unspecified') {
        missingInformation.push('Severity level was not provided.');
    }
    if (!text && emergencySigns.length === 0) {
        missingInformation.push('No specific symptom description was entered.');
    }

    const disclaimer = 'RELIEF provides general health information for educational purposes only. It is not a medical diagnosis, does not provide clinical care, and cannot replace in-person assessment by a qualified healthcare professional.';
    const prescriptionDisclaimer = 'RELIEF does not recommend starting, stopping, or altering prescription medications or changing dosages. Consult your prescribing doctor or a licensed pharmacist regarding any medications.';
    const emergencyScreeningDisclaimer = 'Automated keyword screening cannot rule out a medical emergency. If your symptoms feel severe, unusual, or rapidly worsen, seek emergency medical care immediately.';

    // High-risk emergency scenario: Safety logic takes complete precedence
    if (emergencyEval.isEmergency) {
        return {
            isEmergency: true,
            emergencyReasons: emergencyEval.reasons,
            isAmbiguous: false,
            missingInformation,
            safetyNotice: 'POTENTIAL MEDICAL EMERGENCY: Immediate professional emergency care is indicated.',
            disclaimer,
            prescriptionDisclaimer,
            emergencyScreeningDisclaimer,
            generalTopics: [], // Suppressed so routine information cannot distract from emergency care
            recommendedActions: [
                'Seek immediate emergency medical care.',
                'Contact your regional emergency telephone service immediately: 112 (India / European Union / international GSM standard), 911 (US / Canada), 999 (UK), or your national emergency number.',
                'Go to the nearest hospital emergency department or urgent care facility.',
                'Do not drive yourself if experiencing chest pain, fainting, or severe distress; have an ambulance or caregiver transport you.',
                'Do not wait or delay emergency care to research symptoms further.'
            ],
            emergencyGuidance: {
                headline: 'Immediate Emergency Care Needed',
                description: 'Based on the reported warning signs, you should seek emergency medical attention right away. Routine care recommendations do not apply to potential medical emergencies.',
                primaryAction: 'Call Regional Emergency Services'
            }
        };
    }

    // Check for ambiguous or empty input
    const isGibberishOrEmpty = !text || text.length < 3 || /^(asdf|test|none|nothing|\?+|!+|hello|hi|ok)$/i.test(text);

    if (isGibberishOrEmpty) {
        return {
            isEmergency: false,
            emergencyReasons: [],
            isAmbiguous: true,
            missingInformation,
            safetyNotice: 'Limited or ambiguous symptom details provided. The absence of identified symptoms does not confirm you are healthy or safe. If you feel unwell or concerned, seek an in-person assessment by a healthcare professional.',
            disclaimer,
            prescriptionDisclaimer,
            emergencyScreeningDisclaimer,
            generalTopics: [
                {
                    title: 'General Health Assessment Consideration',
                    description: 'Because limited or ambiguous symptom details were entered, the system cannot identify specific educational topics. Many health issues do not present with obvious single symptoms.',
                    discussionPoints: [
                        'Consult a qualified healthcare professional for a complete in-person evaluation.',
                        'Monitor for any emerging or worsening sensations.',
                        'Remember that lack of identified symptoms in this tool is not proof that you are free from illness.'
                    ]
                }
            ],
            recommendedActions: [
                'If you feel sick, in pain, or concerned, consult a qualified healthcare professional.',
                'Seek immediate emergency care if any severe warning signs (such as chest pain or breathing difficulty) develop.',
                'Do not start or change prescription medications without medical consultation.'
            ]
        };
    }

    // Standard, non-emergency symptom information flow (strictly non-diagnostic)
    const generalTopics = [];

    // Educational discussion topics based on reported symptoms (never presented as confirmed diagnoses)
    if (/\b(headache|head\s*pain|migraine)\b/i.test(text)) {
        generalTopics.push({
            title: 'Headache Patterns and Topics to Discuss',
            description: 'Headaches are common and can have multiple contributing factors, such as muscle tension, stress, dehydration, sinus inflammation, eye strain, or other underlying causes.',
            discussionPoints: [
                'Describe the exact location, timing, frequency, and sensation (throbbing, dull, pressure) to your doctor.',
                'Note whether headaches are triggered by lack of sleep, screen time, or certain foods.',
                'Seek urgent medical care if a headache begins suddenly with extreme intensity or is accompanied by stiff neck, fever, or confusion.'
            ]
        });
    }

    if (/\b(fever|chills|high\s*temp|temperature|feverish)\b/i.test(text)) {
        generalTopics.push({
            title: 'Body Temperature and Fever Response',
            description: 'Elevated body temperature is typically a protective immune response to an infection (viral or bacterial) or inflammatory process.',
            discussionPoints: [
                'Track your temperature with a reliable thermometer and note how high it rises and how long it lasts.',
                'Observe whether the fever responds to hydration and rest.',
                'Consult a doctor promptly if fever remains high, lasts more than 3 days, or is accompanied by confusion, stiff neck, or rash.'
            ]
        });
    }

    if (/\b(cough|coughing)\b/i.test(text)) {
        generalTopics.push({
            title: 'Cough and Respiratory Irritation',
            description: 'Coughing is a natural reflex to clear airway passages and may be triggered by upper respiratory viral infections, post-nasal drip, environmental allergens, or irritants.',
            discussionPoints: [
                'Tell your physician whether the cough is dry or produces mucus, and note any changes in sputum color.',
                'Discuss how long the cough has persisted and if it is worse at night or after exertion.',
                'Seek urgent care if coughing is accompanied by breathing difficulty or if any blood is present.'
            ]
        });
    }

    if (/\b(sore\s*throat|throat\s*pain|scratchy\s*throat)\b/i.test(text)) {
        generalTopics.push({
            title: 'Throat Discomfort Considerations',
            description: 'Sore throats commonly accompany viral infections, dry indoor air, vocal strain, or bacterial infections such as strep throat.',
            discussionPoints: [
                'Ask your doctor whether a rapid throat swab is appropriate to evaluate for bacterial causes.',
                'Monitor for difficulty swallowing liquids or breathing, which warrants urgent clinical evaluation.'
            ]
        });
    }

    if (/\b(stomach|abdominal|belly|nausea|vomit|diarrhea|cramp)\b/i.test(text)) {
        generalTopics.push({
            title: 'Digestive and Abdominal Considerations',
            description: 'Abdominal discomfort, nausea, or altered bowel habits can arise from dietary changes, viral gastroenteritis, indigestion, or other gastrointestinal conditions.',
            discussionPoints: [
                'Discuss the specific location of the discomfort and its relationship to meals with your doctor.',
                'Maintain small, frequent sips of water or oral rehydration fluids.',
                'Seek urgent care if you experience severe sudden localized abdominal pain, high fever, or inability to keep fluids down.'
            ]
        });
    }

    if (/\b(fatigue|tired|exhaustion|low\s*energy)\b/i.test(text)) {
        generalTopics.push({
            title: 'Fatigue and Energy Considerations',
            description: 'Fatigue can stem from inadequate sleep, recovery from viral illness, stress, nutritional deficiencies, or underlying medical conditions.',
            discussionPoints: [
                'Discuss recent sleep patterns, physical activity, and stress levels with your healthcare provider.',
                'Ask your physician whether basic routine blood work (such as iron or thyroid evaluation) is indicated.'
            ]
        });
    }

    // Default fallback topic if specific terms did not match recognized patterns
    if (generalTopics.length === 0) {
        generalTopics.push({
            title: 'General Symptom Information (Multi-Cause Consideration)',
            description: 'The symptoms you described can be associated with a broad range of potential health conditions. Because many conditions share overlapping symptoms, only a qualified physician can determine the cause through a clinical evaluation.',
            discussionPoints: [
                'Prepare a summary of when your symptoms started, how they feel, and what improves or worsens them.',
                'Share your personal medical history, allergies, and current health status with your doctor.'
            ]
        });
    }

    // Construct supportive, non-prescriptive recommendations
    const recommendedActions = [
        'Schedule an evaluation with a qualified doctor or healthcare professional for a medical assessment.',
        'Consult a doctor or licensed pharmacist before taking or changing any over-the-counter or prescription medications.',
        'Rest adequately, avoid strenuous exertion, and maintain good hydration.',
        'Keep a written log of your symptoms (onset, intensity, changes, and duration) to share with your healthcare provider.'
    ];

    if (duration === 'more-than-week') {
        recommendedActions.push('Since your symptoms have persisted for more than a week, an in-person clinical assessment is strongly recommended.');
    }

    if (severity === 'severe') {
        recommendedActions.push('Because you rated your symptoms as severe, seek prompt same-day medical attention or urgent care rather than waiting.');
    }

    recommendedActions.push('If your symptoms suddenly worsen or new warning signs appear (such as chest pain or breathing difficulty), seek immediate emergency medical care.');

    return {
        isEmergency: false,
        emergencyReasons: [],
        isAmbiguous: false,
        missingInformation,
        safetyNotice: 'The information provided here is general and educational. It is not a medical diagnosis.',
        disclaimer,
        prescriptionDisclaimer,
        emergencyScreeningDisclaimer,
        generalTopics,
        recommendedActions
    };
}

// 3. Browser-Side Interactive Form Handling
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('symptoms-form');
        if (!form) return;

        const steps = document.querySelectorAll('.form-step');
        const stepIndicators = document.querySelectorAll('.checker-steps .step');
        const immediateEmergencyAlert = document.getElementById('immediate-emergency-alert');
        const symptomsInput = document.getElementById('symptoms');
        const emergencyCheckboxes = document.querySelectorAll('input[name="emergency_sign"]');
        let currentStep = 0;

        // Name each step for assistive technology, then show the first one without taking focus.
        steps.forEach((step, index) => {
            const heading = stepIndicators[index] ? stepIndicators[index].querySelector('p') : null;
            step.setAttribute('role', 'group');
            step.setAttribute('aria-label', 'Step ' + (index + 1) + ' of ' + steps.length + (heading ? ': ' + heading.textContent.trim() : ''));
            step.setAttribute('tabindex', '-1');
        });
        showStep(currentStep, false);

        // Real-time emergency warning check on Step 1
        function checkRealtimeEmergency() {
            if (!immediateEmergencyAlert) return;

            const symptomsVal = symptomsInput ? symptomsInput.value : '';
            const checkedSigns = Array.from(emergencyCheckboxes)
                .filter(cb => cb.checked)
                .map(cb => cb.value);

            const detection = detectEmergencySigns({
                symptomsText: symptomsVal,
                selectedSigns: checkedSigns
            });

            if (detection.isEmergency) {
                immediateEmergencyAlert.style.display = 'flex';
            } else {
                immediateEmergencyAlert.style.display = 'none';
            }
        }

        if (symptomsInput) {
            symptomsInput.addEventListener('input', checkRealtimeEmergency);
        }

        emergencyCheckboxes.forEach(cb => {
            cb.addEventListener('change', checkRealtimeEmergency);
        });

        // Direct skip to emergency guidance from alert
        document.getElementById('btn-skip-to-emergency')?.addEventListener('click', function() {
            currentStep = 2; // Jump straight to results step
            showStep(currentStep, true);
            updateStepIndicators();
        });

        // Next button click handler
        document.querySelectorAll('.btn-next').forEach(button => {
            button.addEventListener('click', function() {
                if (validateStep(currentStep)) {
                    currentStep++;
                    if (currentStep >= steps.length) {
                        currentStep = steps.length - 1;
                    }
                    showStep(currentStep, true);
                    updateStepIndicators();
                }
            });
        });

        // Previous button click handler
        document.querySelectorAll('.btn-prev').forEach(button => {
            button.addEventListener('click', function() {
                currentStep--;
                if (currentStep < 0) currentStep = 0;
                showStep(currentStep, true);
                updateStepIndicators();
            });
        });

        // Restart button click handler
        document.querySelector('.btn-restart')?.addEventListener('click', function() {
            currentStep = 0;
            form.reset();
            if (immediateEmergencyAlert) {
                immediateEmergencyAlert.style.display = 'none';
            }
            const resultsContent = document.querySelector('.results-content');
            if (resultsContent) resultsContent.style.display = 'none';
            showStep(currentStep, true);
            updateStepIndicators();
        });

        // Emergency button click handlers: respect element's target telephone number
        document.querySelectorAll('.btn-emergency, .btn-call-emergency').forEach(btn => {
            btn.addEventListener('click', function(e) {
                if (btn.tagName.toLowerCase() !== 'a') {
                    const targetTel = btn.getAttribute('data-tel') || 'tel:112';
                    window.location.href = targetTel;
                }
            });
        });

        // moveFocus is true after a button press. The button that was pressed is inside the step
        // that is now hidden, so without this keyboard focus falls back to the top of the page and
        // a screen reader says nothing about the new step.
        function showStep(stepIndex, moveFocus) {
            steps.forEach((step, index) => {
                step.classList.toggle('active', index === stepIndex);
            });

            if (stepIndex === 2) {
                renderAnalysisResults(moveFocus);
            } else if (moveFocus && steps[stepIndex]) {
                steps[stepIndex].focus();
            }
        }

        // Graceful step validation: Does not block users with modal alerts
        function validateStep(stepIndex) {
            // All steps are navigable; incomplete fields are handled gracefully in evaluation
            return true;
        }

        function updateStepIndicators() {
            stepIndicators.forEach((indicator, index) => {
                if (index === currentStep) indicator.setAttribute('aria-current', 'step');
                else indicator.removeAttribute('aria-current');
                indicator.classList.toggle('active', index === currentStep);
                indicator.classList.toggle('completed', index < currentStep);
            });
        }

        function renderAnalysisResults(moveFocus) {
            const loading = document.querySelector('.loading');
            const results = document.querySelector('.results-content');

            if (loading) {
                loading.style.display = 'block';
                loading.setAttribute('role', 'status');
            }
            if (results) results.style.display = 'none';

            // Gather inputs
            const symptomsText = symptomsInput ? symptomsInput.value : '';
            const checkedSigns = Array.from(emergencyCheckboxes)
                .filter(cb => cb.checked)
                .map(cb => cb.value);

            const durationEl = document.querySelector('input[name="duration"]:checked');
            const duration = durationEl ? durationEl.value : 'unspecified';

            const severityEl = document.getElementById('severity');
            const severity = severityEl ? severityEl.value : 'unspecified';

            const additionalInfoEl = document.getElementById('additional-info');
            const additionalInfo = additionalInfoEl ? additionalInfoEl.value : '';

            const medicationsEl = document.getElementById('medications');
            const medications = medicationsEl ? medicationsEl.value : '';

            // Run pure safety evaluation
            const evaluation = evaluateSymptomSafety({
                symptomsText,
                emergencySigns: checkedSigns,
                duration,
                severity,
                additionalInfo,
                medications
            });

            // Brief transition to simulate processing while remaining fast
            setTimeout(() => {
                const urgentContainer = document.getElementById('urgent-emergency-container');
                const urgentReasons = document.getElementById('urgent-reasons');
                const topicsSection = document.getElementById('topics-section');
                const conditionsList = document.getElementById('conditions-list');
                const recommendationsSection = document.getElementById('recommendations-section');
                const recommendationsEl = document.getElementById('recommendations');
                const missingNotice = document.getElementById('missing-info-notice');
                const missingText = document.getElementById('missing-info-text');

                // Render Urgent Emergency Guidance
                if (evaluation.isEmergency) {
                    if (urgentContainer) urgentContainer.style.display = 'block';
                    if (urgentReasons) {
                        urgentReasons.innerHTML = `
                            <p><strong>Identified Warning Signs:</strong></p>
                            <ul>
                                ${evaluation.emergencyReasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                            </ul>
                        `;
                    }
                    // Routine topics are suppressed so emergency care is not distracted
                    if (topicsSection) topicsSection.style.display = 'none';
                    if (recommendationsSection) recommendationsSection.style.display = 'none';
                } else {
                    if (urgentContainer) urgentContainer.style.display = 'none';
                    if (topicsSection) topicsSection.style.display = 'block';
                    if (recommendationsSection) recommendationsSection.style.display = 'block';

                    // Render General Educational Topics (strictly non-diagnostic)
                    if (conditionsList) {
                        conditionsList.innerHTML = evaluation.generalTopics.map(topic => `
                            <div class="condition-item">
                                <h4><i class="fas fa-stethoscope"></i> ${escapeHtml(topic.title)}</h4>
                                <p>${escapeHtml(topic.description)}</p>
                                ${topic.discussionPoints && topic.discussionPoints.length > 0 ? `
                                    <div class="topic-discussion-points">
                                        <strong>Suggested discussion points for your doctor:</strong>
                                        <ul>
                                            ${topic.discussionPoints.map(dp => `<li>${escapeHtml(dp)}</li>`).join('')}
                                        </ul>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('');
                    }

                    // Render Recommended Next Steps
                    if (recommendationsEl) {
                        recommendationsEl.innerHTML = `
                            <h4>Suggested Next Steps (Supportive Guidance):</h4>
                            <ul>
                                ${evaluation.recommendedActions.map(act => `<li>${escapeHtml(act)}</li>`).join('')}
                            </ul>
                            <div class="prescription-warning-box">
                                <i class="fas fa-pills"></i>
                                <p><strong>Prescription Safety Note:</strong> ${escapeHtml(evaluation.prescriptionDisclaimer)}</p>
                            </div>
                            <div class="screening-limitation-note">
                                <p><i class="fas fa-exclamation-circle"></i> ${escapeHtml(evaluation.emergencyScreeningDisclaimer)}</p>
                            </div>
                        `;
                    }
                }

                // Render Incomplete Information Notice
                if (missingNotice && missingText) {
                    if (evaluation.missingInformation.length > 0 || evaluation.isAmbiguous) {
                        missingNotice.style.display = 'flex';
                        missingText.innerHTML = `
                            ${evaluation.missingInformation.map(m => `<span>• ${escapeHtml(m)}</span>`).join(' ')}
                            <br><small>Because some details were omitted, overall clinical uncertainty is increased. Be sure to share your complete symptom history with a healthcare professional.</small>
                        `;
                    } else {
                        missingNotice.style.display = 'none';
                    }
                }

                if (loading) loading.style.display = 'none';
                if (results) {
                    results.style.display = 'block';
                    if (moveFocus) {
                        // The results replace the loading text; start reading at the top of them.
                        results.setAttribute('role', 'region');
                        results.setAttribute('aria-label', 'Your guidance results');
                        results.setAttribute('tabindex', '-1');
                        results.focus();
                    }
                }
            }, 250);
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        }
    });

    // Mobile Menu & Navigation functionality
    document.addEventListener('DOMContentLoaded', function() {
        const hamburger = document.querySelector('.hamburger');
        if (!hamburger || hamburger.dataset.navInitialized === 'true') {
            return;
        }

        const navLinks = document.querySelector('.nav-links');
        if (hamburger && navLinks) {
            hamburger.dataset.navInitialized = 'true';
            hamburger.addEventListener('click', function() {
                const expanded = this.getAttribute('aria-expanded') === 'true';
                this.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                navLinks.classList.toggle('active');
            });
        }

        const dropdownToggles = document.querySelectorAll('.dropdown-toggle');
        dropdownToggles.forEach(toggle => {
            toggle.addEventListener('click', function(e) {
                if (window.innerWidth <= 992) {
                    e.preventDefault();
                    const dropdown = this.closest('.dropdown');
                    if (dropdown) {
                        dropdown.classList.toggle('active');
                    }
                }
            });
        });
    });
}

// 4. Exports for Node.js Testing and Global Browser Access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MEDICAL_SOURCES,
        EMERGENCY_SIGNS_CATALOG,
        EMERGENCY_KEYWORD_PATTERNS,
        isMatchNegated,
        detectEmergencySigns,
        evaluateSymptomSafety
    };
}

if (typeof window !== 'undefined') {
    window.SymptomSafety = {
        MEDICAL_SOURCES,
        EMERGENCY_SIGNS_CATALOG,
        EMERGENCY_KEYWORD_PATTERNS,
        isMatchNegated,
        detectEmergencySigns,
        evaluateSymptomSafety
    };
}
