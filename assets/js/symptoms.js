document.addEventListener('DOMContentLoaded', function() {
    // Form navigation
    const form = document.getElementById('symptoms-form');
    const steps = document.querySelectorAll('.form-step');
    const stepIndicators = document.querySelectorAll('.checker-steps .step');
    let currentStep = 0;

    // Show first step
    showStep(currentStep);

    // Next button click handler
    document.querySelectorAll('.btn-next').forEach(button => {
        button.addEventListener('click', function() {
            if (validateStep(currentStep)) {
                currentStep++;
                showStep(currentStep);
                updateStepIndicators();
            }
        });
    });

    // Previous button click handler
    document.querySelectorAll('.btn-prev').forEach(button => {
        button.addEventListener('click', function() {
            currentStep--;
            showStep(currentStep);
            updateStepIndicators();
        });
    });

    // Restart button click handler
    document.querySelector('.btn-restart')?.addEventListener('click', function() {
        currentStep = 0;
        showStep(currentStep);
        updateStepIndicators();
        form.reset();
        document.querySelector('.results-content').style.display = 'none';
    });

    // Emergency button click handler
    document.querySelector('.btn-emergency')?.addEventListener('click', function() {
        window.location.href = 'tel:911';
    });

    // Show current step
    function showStep(stepIndex) {
        steps.forEach((step, index) => {
            step.classList.toggle('active', index === stepIndex);
        });

        // If it's the results step, start analysis
        if (stepIndex === 2) {
            analyzeSymptoms();
        }
    }

    // Validate current step before proceeding
    function validateStep(stepIndex) {
        let isValid = true;

        if (stepIndex === 0) {
            const symptoms = document.getElementById('symptoms').value.trim();
            const durationSelected = document.querySelector('input[name="duration"]:checked');

            if (!symptoms) {
                alert('Please describe your symptoms');
                isValid = false;
            } else if (!durationSelected) {
                alert('Please select how long you\'ve had these symptoms');
                isValid = false;
            }
        } else if (stepIndex === 1) {
            const severity = document.getElementById('severity').value;

            if (!severity) {
                alert('Please select symptom severity');
                isValid = false;
            }
        }

        return isValid;
    }

    // Update step indicators
    function updateStepIndicators() {
        stepIndicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === currentStep);
            indicator.classList.toggle('completed', index < currentStep);
        });
    }

    // Main symptom analysis function
    async function analyzeSymptoms() {
        const loading = document.querySelector('.loading');
        const results = document.querySelector('.results-content');

        loading.style.display = 'block';
        results.style.display = 'none';

        // Get user inputs
        const symptomsText = document.getElementById('symptoms').value.toLowerCase();
        const duration = document.querySelector('input[name="duration"]:checked').value;
        const severity = document.getElementById('severity').value;

        try {
            // Try to use real API first
            const analysis = await analyzeWithAPI(symptomsText);
            displayAnalysisResults(analysis, duration, severity);
        } catch (error) {
            console.error('API analysis failed, using mock data:', error);
            // Fall back to mock data if API fails
            generateMockResults(symptomsText, duration, severity);
        } finally {
            loading.style.display = 'none';
            results.style.display = 'block';
        }
    }

    // Analyze symptoms using API
    async function analyzeWithAPI(symptomsText) {
        // Map symptoms to API format
        const symptoms = mapSymptomsToAPI(symptomsText);

        // Get user data (in a real app, this would come from user profile)
        const userData = {
            age: 30, // Default age - should be from profile
            sex: 'male' // Default sex - should be from profile
        };

        // Call the API (using Infermedica as example)
        const response = await fetch('https://api.infermedica.com/v3/diagnosis', {
            method: 'POST',
            headers: {
                'App-Id': 'YOUR_INFERMEDICA_APP_ID',
                'App-Key': 'YOUR_INFERMEDICA_APP_KEY',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sex: userData.sex,
                age: { value: userData.age },
                evidence: symptoms
            })
        });

        if (!response.ok) {
            throw new Error('API request failed');
        }

        return await response.json();
    }

    // Map user symptoms to API format
    function mapSymptomsToAPI(symptomsText) {
        // This is a simplified mapping - in a real app, you'd have a more comprehensive mapping
        const symptomMap = {
            headache: { id: 's_21', choice_id: 'present' },
            fever: { id: 's_98', choice_id: 'present' },
            cough: { id: 's_22', choice_id: 'present' },
            'chest pain': { id: 's_11', choice_id: 'present' },
            'shortness of breath': { id: 's_30', choice_id: 'present' }
        };

        const evidence = [];

        // Check for each known symptom
        for (const [keyword, symptomData] of Object.entries(symptomMap)) {
            if (symptomsText.includes(keyword)) {
                evidence.push({
                    id: symptomData.id,
                    choice_id: symptomData.choice_id,
                    initial: true
                });
            }
        }

        return evidence;
    }

    // Display API analysis results
    function displayAnalysisResults(apiResponse, duration, severity) {
        const conditionsList = document.querySelector('.conditions-list');
        const recommendations = document.querySelector('.recommendations');
        const emergencyWarning = document.querySelector('.emergency-warning');

        // Clear previous results
        conditionsList.innerHTML = '';
        recommendations.innerHTML = '';
        emergencyWarning.style.display = 'none';

        // Display conditions
        if (apiResponse.conditions && apiResponse.conditions.length > 0) {
            apiResponse.conditions.forEach(condition => {
                const conditionItem = document.createElement('div');
                conditionItem.className = 'condition-item';
                conditionItem.innerHTML = `
                    <h4>${condition.common_name}</h4>
                    <p>Probability: ${Math.round(condition.probability * 100)}%</p>
                    <p>${condition.hint || ''}</p>
                `;
                conditionsList.appendChild(conditionItem);
            });
        } else {
            conditionsList.innerHTML = '<p>No specific conditions identified</p>';
        }

        // Display recommendations
        if (apiResponse.triage_level === 'emergency') {
            emergencyWarning.style.display = 'block';
        } else {
            recommendations.innerHTML = '<h4>Recommended Next Steps:</h4><ul></ul>';
            const recommendationsList = recommendations.querySelector('ul');

            // Add API recommendations
            if (apiResponse.recommended_channel) {
                apiResponse.recommended_channel.forEach(rec => {
                    const li = document.createElement('li');
                    li.textContent = rec;
                    recommendationsList.appendChild(li);
                });
            }

            // Add duration-specific advice
            if (duration === 'more-than-week') {
                const li = document.createElement('li');
                li.textContent = 'Since your symptoms have persisted for more than a week, consider consulting a healthcare provider.';
                recommendationsList.appendChild(li);
            }

            // Add severity-specific advice
            if (severity === 'severe') {
                const li = document.createElement('li');
                li.textContent = 'Given the severity of your symptoms, you may want to seek medical attention soon.';
                recommendationsList.appendChild(li);
            }

            // Add default advice if no specific recommendations
            if (recommendationsList.children.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'Monitor your symptoms and consult a healthcare provider if they persist or worsen.';
                recommendationsList.appendChild(li);
            }
        }
    }

    // Fallback mock results generator
    function generateMockResults(symptoms, duration, severity) {
        const conditionsList = document.querySelector('.conditions-list');
        const recommendations = document.querySelector('.recommendations');
        const emergencyWarning = document.querySelector('.emergency-warning');

        // Clear previous results
        conditionsList.innerHTML = '';
        recommendations.innerHTML = '';

        // Common conditions and recommendations
        const commonConditions = {
            headache: {
                name: 'Tension Headache',
                description: 'A common headache often caused by stress, muscle tension, or fatigue.',
                recommendations: [
                    'Rest in a quiet, dark room',
                    'Apply a cold or warm compress to your head or neck',
                    'Try relaxation techniques like deep breathing',
                    'Consider over-the-counter pain relievers like ibuprofen or acetaminophen',
                    'Stay hydrated and maintain regular sleep patterns'
                ]
            },
            fever: {
                name: 'Viral Infection',
                description: 'A fever is often a sign your body is fighting an infection.',
                recommendations: [
                    'Get plenty of rest',
                    'Drink fluids to stay hydrated',
                    'Take fever-reducing medication like acetaminophen or ibuprofen',
                    'Use a cool compress if you feel too warm',
                    'Monitor your temperature regularly'
                ]
            },
            cough: {
                name: 'Upper Respiratory Infection',
                description: 'A cough is often caused by a viral infection in the upper respiratory tract.',
                recommendations: [
                    'Stay hydrated with warm liquids',
                    'Use a humidifier to moisten the air',
                    'Consider cough drops or honey to soothe throat irritation',
                    'Avoid irritants like smoke or strong perfumes',
                    'Get plenty of rest'
                ]
            },
            'chest pain': {
                name: 'Possible Cardiac Issue (Seek Immediate Care)',
                description: 'Chest pain can be a sign of a serious condition and should be evaluated immediately.',
                emergency: true
            },
            'shortness of breath': {
                name: 'Possible Respiratory or Cardiac Issue (Seek Immediate Care)',
                description: 'Difficulty breathing can indicate a serious medical condition.',
                emergency: true
            }
        };

        // Determine which conditions match the symptoms
        const matchedConditions = [];
        let showEmergency = false;

        for (const [keyword, condition] of Object.entries(commonConditions)) {
            if (symptoms.includes(keyword)) {
                matchedConditions.push(condition);

                if (condition.emergency) {
                    showEmergency = true;
                }
            }
        }

        // If no specific conditions matched, show generic advice
        if (matchedConditions.length === 0) {
            matchedConditions.push({
                name: 'General Symptoms',
                description: 'Your symptoms don\'t match specific conditions in our database. Consider consulting a healthcare provider for evaluation.',
                recommendations: [
                    'Monitor your symptoms for changes',
                    'Rest and stay hydrated',
                    'Consider consulting a healthcare provider if symptoms persist or worsen'
                ]
            });
        }

        // Display conditions
        matchedConditions.forEach(condition => {
            const conditionItem = document.createElement('div');
            conditionItem.className = 'condition-item';
            conditionItem.innerHTML = `
                <h4>${condition.name}</h4>
                <p>${condition.description}</p>
            `;
            conditionsList.appendChild(conditionItem);
        });

        // Display recommendations (for non-emergency conditions)
        if (!showEmergency) {
            recommendations.innerHTML = '<h4>Based on your symptoms, we recommend:</h4><ul></ul>';
            const recommendationsList = recommendations.querySelector('ul');

            matchedConditions.forEach(condition => {
                if (condition.recommendations) {
                    condition.recommendations.forEach(item => {
                        const li = document.createElement('li');
                        li.textContent = item;
                        recommendationsList.appendChild(li);
                    });
                }
            });

            // Add duration-specific advice
            if (duration === 'more-than-week') {
                const li = document.createElement('li');
                li.textContent = 'Since your symptoms have persisted for more than a week, consider consulting a healthcare provider.';
                recommendationsList.appendChild(li);
            }

            // Add severity-specific advice
            if (severity === 'severe') {
                const li = document.createElement('li');
                li.textContent = 'Given the severity of your symptoms, you may want to seek medical attention soon.';
                recommendationsList.appendChild(li);
            }
        }

        // Show emergency warning if needed
        emergencyWarning.style.display = showEmergency ? 'block' : 'none';
    }
});












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
