/**
 * Focused Unit and Regression Test Suite for Issue #20:
 * Medically Cautious Symptom-Information Guidance
 *
 * Covers all 8 scenarios specified in GitHub Issue #20 requirements:
 * 1. Normal symptom-information flow
 * 2. Incomplete answers
 * 3. High-risk symptoms
 * 4. Safety disclaimer
 * 5. Unsupported diagnosis
 * 6. Prescription medication
 * 7. Ambiguous or invalid input
 * 8. Regression
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
    evaluateSymptomSafety,
    detectEmergencySigns,
    isMatchNegated,
    MEDICAL_SOURCES,
    EMERGENCY_SIGNS_CATALOG
} = require('../assets/js/symptoms.js');

describe('GitHub Issue #20: Medically Cautious Symptom-Information Guidance', () => {

    // Test 1: Normal symptom-information flow
    describe('Test 1: Normal symptom-information flow', () => {
        it('displays general health information with clear medical limitations for complete non-emergency input', () => {
            const input = {
                symptomsText: 'mild headache and occasional dry cough',
                emergencySigns: [],
                duration: '1-3-days',
                severity: 'mild'
            };

            const result = evaluateSymptomSafety(input);

            // Must not be flagged as emergency
            assert.strictEqual(result.isEmergency, false, 'Non-emergency input must not be marked as emergency');
            assert.strictEqual(result.isAmbiguous, false, 'Valid symptom input must not be marked ambiguous');

            // Must provide educational discussion topics (not diagnoses)
            assert.ok(result.generalTopics.length > 0, 'General health topics must be provided');
            const topicTitles = result.generalTopics.map(t => t.title).join(' ');
            assert.ok(/headache/i.test(topicTitles), 'Should include headache educational topic');
            assert.ok(/cough/i.test(topicTitles), 'Should include cough educational topic');

            // Must contain clinical limitations and uncertainty disclaimers
            assert.ok(result.disclaimer.includes('not a medical diagnosis'), 'Must state it is not a medical diagnosis');
            assert.ok(result.disclaimer.includes('qualified healthcare professional'), 'Must mention consultation with healthcare professional');

            // Must provide supportive care advice
            assert.ok(result.recommendedActions.some(act => /doctor|physician|healthcare/i.test(act)), 'Must recommend professional assessment');
            assert.ok(result.recommendedActions.some(act => /rest/i.test(act)), 'Must include supportive rest guidance');
        });
    });

    // Test 2: Incomplete answers
    describe('Test 2: Incomplete answers', () => {
        it('handles missing/skipped fields gracefully without inventing symptoms or claiming diagnosis', () => {
            // User enters symptoms but skips duration and severity
            const input = {
                symptomsText: 'feeling tired and sore throat',
                emergencySigns: [],
                duration: 'unspecified',
                severity: 'unspecified'
            };

            const result = evaluateSymptomSafety(input);

            // Must execute without errors
            assert.strictEqual(result.isEmergency, false);
            assert.ok(result.missingInformation.length >= 2, 'Should track missing duration and severity');
            assert.ok(result.missingInformation.some(m => /duration/i.test(m)), 'Should record missing duration');
            assert.ok(result.missingInformation.some(m => /severity/i.test(m)), 'Should record missing severity');

            // Must not invent symptoms
            const topicTitles = result.generalTopics.map(t => t.title).join(' ');
            assert.ok(!/chest pain|cardiac|stroke|paralysis/i.test(topicTitles), 'Must not fabricate unmentioned symptoms');

            // Must communicate uncertainty
            assert.ok(result.disclaimer.length > 0);
        });

        it('handles case where user skips symptom description but provides partial metadata', () => {
            const input = {
                symptomsText: '',
                emergencySigns: [],
                duration: '1-3-days',
                severity: 'mild'
            };

            const result = evaluateSymptomSafety(input);
            assert.strictEqual(result.isEmergency, false);
            assert.strictEqual(result.isAmbiguous, true, 'Empty symptom text should be marked as ambiguous');
            assert.ok(result.missingInformation.some(m => /description/i.test(m)), 'Should record missing symptom description');
        });
    });

    // Test 3: High-risk symptoms
    describe('Test 3: High-risk symptoms', () => {
        it('prioritizes immediate emergency guidance when emergency checkbox is selected', () => {
            const input = {
                symptomsText: 'slight cough',
                emergencySigns: ['chest_pain'],
                duration: 'less-than-day',
                severity: 'severe'
            };

            const result = evaluateSymptomSafety(input);

            assert.strictEqual(result.isEmergency, true, 'Must identify emergency status');
            assert.ok(result.emergencyReasons.length > 0, 'Must provide emergency reasons');
            assert.ok(result.emergencyReasons.some(r => /chest pain/i.test(r)), 'Must reference chest pain warning sign');

            // Routine suggestions must NOT take precedence (generalTopics is suppressed)
            assert.strictEqual(result.generalTopics.length, 0, 'Routine condition topics must be suppressed for emergencies');

            // Immediate emergency calling guidance must be primary
            assert.ok(result.recommendedActions.some(act => /emergency/i.test(act)), 'Must recommend immediate emergency care');
            assert.ok(result.recommendedActions.some(act => /911|112|999/i.test(act)), 'Must reference local emergency numbers');
        });

        it('detects emergency warning signs from free-text descriptions', () => {
            const emergencyPhrases = [
                'I have sudden severe chest tightness and pressure',
                'My mother has facial drooping and slurred speech',
                'Having extreme shortness of breath and cannot breathe',
                'Coughing up blood after severe accident',
                'Worst headache of my life that started suddenly',
                'Passed out and lost consciousness for two minutes'
            ];

            emergencyPhrases.forEach(phrase => {
                const detection = detectEmergencySigns({ symptomsText: phrase, selectedSigns: [] });
                assert.strictEqual(detection.isEmergency, true, `Phrase "${phrase}" must be detected as an emergency`);
                assert.ok(detection.reasons.length > 0, 'Must record specific emergency reason');
            });
        });

        it('detects diverse wording variations for emergency indicators', () => {
            const variationPhrases = [
                { phrase: 'I have severe pain in my chest that radiates to my left arm', reasonMatch: /chest pain/i },
                { phrase: 'Feeling tightness in my chest and heaviness', reasonMatch: /chest/i },
                { phrase: 'I am unable to breathe properly and choking', reasonMatch: /breathing/i },
                { phrase: 'Having trouble breathing and lips turning blue', reasonMatch: /breathing/i },
                { phrase: 'He is slurring words and cannot speak clearly', reasonMatch: /stroke/i },
                { phrase: 'Sudden weakness on one side of my body', reasonMatch: /stroke/i },
                { phrase: 'Patient had a seizure and convulsions', reasonMatch: /seizure/i },
                { phrase: 'Brother had an epileptic fit earlier today', reasonMatch: /seizure/i },
                { phrase: 'She blacked out on the floor and was unresponsive', reasonMatch: /fainting|blacking out/i },
                { phrase: 'Passed out suddenly while walking', reasonMatch: /fainting|blacking out/i },
                { phrase: 'My throat is closing up and tongue is swollen', reasonMatch: /allergic/i }
            ];

            variationPhrases.forEach(({ phrase, reasonMatch }) => {
                const detection = detectEmergencySigns({ symptomsText: phrase, selectedSigns: [] });
                assert.strictEqual(detection.isEmergency, true, `Variation "${phrase}" must trigger emergency`);
                assert.ok(detection.reasons.some(r => reasonMatch.test(r)), `Reason for "${phrase}" should match expected clinical indicator`);
            });
        });

        it('correctly handles negated emergency descriptions to avoid false alarms', () => {
            const negatedPhrases = [
                'mild cough and runny nose, no chest pain, no shortness of breath',
                'headache for two days, denies difficulty breathing or chest tightness',
                'fatigue and sore throat, without any chest pain or breathing issues',
                'mild stomach ache, negative for vomiting blood or fainting',
                'fever and chills, never had a seizure, denies slurred speech'
            ];

            negatedPhrases.forEach(phrase => {
                const detection = detectEmergencySigns({ symptomsText: phrase, selectedSigns: [] });
                assert.strictEqual(detection.isEmergency, false, `Negated phrase "${phrase}" must not trigger emergency`);
                assert.strictEqual(detection.reasons.length, 0, `No emergency reasons should be returned for negated phrase "${phrase}"`);

                const evaluation = evaluateSymptomSafety({ symptomsText: phrase, duration: '1-3-days', severity: 'mild' });
                assert.strictEqual(evaluation.isEmergency, false, `Evaluation for "${phrase}" must be non-emergency`);
                assert.ok(evaluation.generalTopics.length > 0, `Should still provide routine educational topics for valid symptoms in "${phrase}"`);
            });
        });

        it('correctly detects active emergency when negation is followed by a contrastive boundary', () => {
            const contrastivePhrases = [
                { phrase: 'no fever, but severe chest pain', expected: /chest pain/i },
                { phrase: 'no chest pain; however, I am unable to breathe', expected: /breathing/i },
                { phrase: 'denies headache, but coughing up blood', expected: /bleed/i },
                { phrase: 'no stomach pain, yet feeling sudden weakness on one side of face', expected: /stroke/i }
            ];

            contrastivePhrases.forEach(({ phrase, expected }) => {
                const detection = detectEmergencySigns({ symptomsText: phrase, selectedSigns: [] });
                assert.strictEqual(detection.isEmergency, true, `Contrastive phrase "${phrase}" must trigger emergency`);
                assert.ok(detection.reasons.some(r => expected.test(r)), `Reason for "${phrase}" must match active symptom`);
            });
        });

        it('provides multi-regional emergency calling instructions without assuming one country', () => {
            const result = evaluateSymptomSafety({
                symptomsText: 'chest tightness and difficulty breathing',
                emergencySigns: [],
                duration: 'less-than-day',
                severity: 'severe'
            });

            assert.strictEqual(result.isEmergency, true);
            const actionsText = result.recommendedActions.join(' ');
            assert.ok(actionsText.includes('112'), 'Must include 112 for India / Europe / GSM');
            assert.ok(actionsText.includes('911'), 'Must include 911 for US / Canada');
            assert.ok(actionsText.includes('999'), 'Must include 999 for UK');
            assert.ok(/nearest hospital emergency department|urgent care/i.test(actionsText), 'Must direct to nearest emergency department');
        });
    });

    // Test 4: Safety disclaimer
    describe('Test 4: Safety disclaimer', () => {
        it('includes clear non-diagnostic limitations in evaluation output', () => {
            const result = evaluateSymptomSafety({ symptomsText: 'headache', duration: '1-3-days', severity: 'mild' });

            assert.ok(result.disclaimer.includes('educational purposes only'), 'Disclaimer must mention educational purpose');
            assert.ok(result.disclaimer.includes('not a medical diagnosis'), 'Disclaimer must state not a diagnosis');
            assert.ok(result.disclaimer.includes('qualified healthcare professional'), 'Disclaimer must advise professional consultation');
        });

        it('verifies safety disclaimer exists in HTML before and alongside results', () => {
            const htmlPath = path.join(__dirname, '..', 'pages', 'symptoms.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf8');

            // Prominent safety banner before the questionnaire steps
            assert.ok(htmlContent.includes('class="safety-disclaimer-banner"'), 'Safety banner must exist in HTML');
            assert.ok(htmlContent.includes('Important Medical Safety Notice'), 'Safety notice header must exist');

            // Clinical limitations box alongside results
            assert.ok(htmlContent.includes('class="safety-limitations-box"'), 'Safety limitations box must exist in results');
            assert.ok(htmlContent.includes('Not a Medical Diagnosis'), 'Not a diagnosis rule must be visible in results');
        });

        it('verifies safety reassurance warning that absence of symptoms does not guarantee safety', () => {
            const standardResult = evaluateSymptomSafety({ symptomsText: 'mild cough', duration: '1-3-days', severity: 'mild' });
            assert.ok(standardResult.emergencyScreeningDisclaimer.includes('cannot rule out a medical emergency'),
                'Standard evaluation must state automated screening cannot rule out emergency');

            const ambiguousResult = evaluateSymptomSafety({ symptomsText: 'test', duration: 'unspecified', severity: 'unspecified' });
            assert.ok(ambiguousResult.safetyNotice.includes('absence of identified symptoms does not confirm you are healthy or safe'),
                'Ambiguous result must warn that lack of symptoms is not proof of safety');

            const htmlPath = path.join(__dirname, '..', 'pages', 'symptoms.html');
            const html = fs.readFileSync(htmlPath, 'utf8');
            assert.ok(html.includes('Safety Reassurance Warning'), 'HTML must include Safety Reassurance Warning in clinical limitations');
        });
    });

    // Test 5: Unsupported diagnosis
    describe('Test 5: Unsupported diagnosis', () => {
        it('does not present conditions as confirmed diagnoses or assign probability percentages', () => {
            const inputs = [
                { symptomsText: 'headache and fatigue', duration: '1-3-days', severity: 'moderate' },
                { symptomsText: 'fever and cough', duration: '4-7-days', severity: 'mild' },
                { symptomsText: 'stomach ache and nausea', duration: 'less-than-day', severity: 'mild' }
            ];

            inputs.forEach(input => {
                const result = evaluateSymptomSafety(input);

                result.generalTopics.forEach(topic => {
                    // Must not claim diagnosis
                    assert.ok(!/confirmed diagnosis|you have been diagnosed/i.test(topic.description), 'Must not claim diagnosis');
                    assert.ok(!/probability:\s*\d+%/i.test(topic.description), 'Must not use probability percentages');

                    // Must frame as discussion topics
                    assert.ok(topic.discussionPoints.length > 0, 'Must provide physician discussion points');
                });
            });
        });
    });

    // Test 6: Prescription medication
    describe('Test 6: Prescription medication', () => {
        it('does not recommend starting, stopping, or changing prescription medications or dosages', () => {
            const inputs = [
                { symptomsText: 'fever and body aches', duration: '1-3-days', severity: 'moderate' },
                { symptomsText: 'severe cough and sinus pressure', duration: 'more-than-week', severity: 'severe' }
            ];

            inputs.forEach(input => {
                const result = evaluateSymptomSafety(input);

                // Check all recommendation actions
                result.recommendedActions.forEach(action => {
                    assert.ok(!/\b\d+\s*mg\b/i.test(action), 'Must not recommend specific medication dosages');
                    assert.ok(!/start taking\s+(antibiotics|steroids|prescription)/i.test(action), 'Must not recommend starting prescription drugs');
                    assert.ok(!/stop taking\s+your\s+medication/i.test(action), 'Must not recommend stopping prescription drugs');
                });

                // Must explicitly include prescription disclaimer
                assert.ok(/does not recommend starting, stopping, or altering prescription medications/i.test(result.prescriptionDisclaimer),
                    'Must include explicit prescription disclaimer');
            });
        });
    });

    // Test 7: Ambiguous or invalid input
    describe('Test 7: Ambiguous or invalid input', () => {
        it('handles empty, gibberish, or ambiguous input gracefully without assuming safety', () => {
            const ambiguousInputs = ['', '   ', 'asdf', '???', 'test', 'hi', 'none'];

            ambiguousInputs.forEach(val => {
                const result = evaluateSymptomSafety({
                    symptomsText: val,
                    emergencySigns: [],
                    duration: 'unspecified',
                    severity: 'unspecified'
                });

                // Must not crash
                assert.strictEqual(result.isEmergency, false);
                assert.strictEqual(result.isAmbiguous, true, `Input "${val}" should be marked ambiguous`);

                // Must not claim that absence of symptoms means the user is safe
                assert.ok(result.safetyNotice.includes('absence of identified symptoms does not confirm you are healthy or safe'),
                    'Must warn that lack of symptoms does not guarantee safety');
                assert.ok(result.recommendedActions.some(act => /consult.*healthcare/i.test(act)),
                    'Must recommend healthcare consultation if feeling unwell');
            });
        });
    });

    // Test 8: Regression
    describe('Test 8: Regression & Navigation Integrity', () => {
        it('verifies tracked medical sources catalog contains required metadata and official sources', () => {
            assert.ok(Array.isArray(MEDICAL_SOURCES), 'MEDICAL_SOURCES must be an array');
            assert.ok(MEDICAL_SOURCES.length >= 4, 'Must document at least 4 public medical sources');

            const orgs = MEDICAL_SOURCES.map(s => s.organization);
            assert.ok(orgs.some(o => /CDC/i.test(o)), 'Must include CDC');
            assert.ok(orgs.some(o => /NHS/i.test(o)), 'Must include NHS');
            assert.ok(orgs.some(o => /WHO/i.test(o)), 'Must include WHO');
            assert.ok(orgs.some(o => /AHA|American Heart Association/i.test(o)), 'Must include AHA');

            MEDICAL_SOURCES.forEach(source => {
                assert.ok(source.title, 'Source must have title');
                assert.ok(source.url && source.url.startsWith('https://'), 'Source must have valid https URL');
                assert.ok(source.dateReviewed, 'Source must have dateReviewed');
                assert.strictEqual(source.status, 'Verified', 'Source must have Verified status');
            });
        });

        it('verifies emergency warning signs catalog is complete and structured', () => {
            const requiredSigns = ['chest_pain', 'breathing_difficulty', 'stroke_symptoms', 'severe_headache_confusion', 'severe_bleeding', 'fainting_unconscious', 'severe_allergy'];

            requiredSigns.forEach(signId => {
                assert.ok(EMERGENCY_SIGNS_CATALOG[signId], `Catalog must contain ${signId}`);
                assert.ok(EMERGENCY_SIGNS_CATALOG[signId].label, `${signId} must have human-readable label`);
                assert.ok(EMERGENCY_SIGNS_CATALOG[signId].reason, `${signId} must have clinical reason`);
            });
        });

        it('verifies existing HTML resources, form actions, and page links remain intact', () => {
            const htmlPath = path.join(__dirname, '..', 'pages', 'symptoms.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            // Resource navigation links preserved
            assert.ok(html.includes('../pages/doctors.html'), 'Doctor link must exist');
            assert.ok(html.includes('../pages/hospitals.html'), 'Hospital link must exist');
            assert.ok(html.includes('../pages/pharmacies.html'), 'Pharmacy link must exist');

            // Form actions and buttons preserved
            assert.ok(html.includes('class="btn-prev"'), 'Previous button must exist');
            assert.ok(html.includes('class="btn-next"'), 'Next button must exist');
            assert.ok(html.includes('class="btn-restart"'), 'Restart button must exist');

            // Emergency call actions preserved
            assert.ok(html.includes('tel:911'), 'Emergency telephone action must exist');
        });

        it('explicitly distinguishes technical verification from clinical approval in sources metadata', () => {
            MEDICAL_SOURCES.forEach(source => {
                assert.strictEqual(source.status, 'Verified', 'Technical status must be Verified');
                assert.ok(source.clinicalStatus, 'Source must document clinical validation status');
                assert.ok(/Awaiting|Pending/i.test(source.clinicalStatus), 'Clinical status must state awaiting/pending validation');
                assert.ok(!/clinically approved|certified/i.test(source.clinicalStatus), 'Technical verification must never be claimed as clinical approval');
            });
        });

        it('verifies multi-regional emergency telephone dialing links exist in HTML', () => {
            const htmlPath = path.join(__dirname, '..', 'pages', 'symptoms.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('href="tel:112"'), 'Must include tel:112 dialing link');
            assert.ok(html.includes('href="tel:911"'), 'Must include tel:911 dialing link');
            assert.ok(html.includes('href="tel:999"'), 'Must include tel:999 dialing link');
            assert.ok(html.includes('emergency-region-note'), 'Must include regional instruction note for other countries');
        });
    });
});
