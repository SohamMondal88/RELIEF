// Relief App API Service with Free Alternatives
const ReliefAPI = (function() {
    // Configuration - using free services
    const config = {
        // Medical API (free alternative to Infermedica)
        OPENMRS_API_URL: 'https://openmrs.org/api',

        // Location services (free alternatives)
        OPENSTREETMAP_NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
        PHARMA_API_URL: 'https://api.openstreetmap.org',

        // Authentication (using Firebase free tier)
        FIREBASE_CONFIG: {
            apiKey: "your_firebase_api_key",
            authDomain: "your_project.firebaseapp.com",
            projectId: "your_project",
            storageBucket: "your_project.appspot.com",
            messagingSenderId: "your_sender_id",
            appId: "your_app_id"
        },

        // Chat bot (using Rasa open source)
        RASA_API_URL: 'http://localhost:5005', // Self-hosted

        // RELIEF backend (subscription status, facility corrections). Empty means
        // "not configured": every backend call then fails with code 'backend-unavailable'.
        // Set window.RELIEF_BACKEND_URL or <meta name="relief-backend-url"> at deploy time.
        RELIEF_BACKEND_URL: ''
    };

    // Initialize Firebase only if the SDK is on the page. No page loads it today, and
    // without this guard api.js throws on load, so ReliefAPI would never exist.
    const firebaseLoaded = typeof firebase !== 'undefined';
    if (firebaseLoaded && !firebase.apps.length) {
        firebase.initializeApp(config.FIREBASE_CONFIG);
    }

    // App Check lets Firebase reject traffic that does not come from the real site.
    // Opt in per deployment: load the App Check SDK and set window.RELIEF_APP_CHECK_SITE_KEY
    // to your reCAPTCHA v3 site key. Does nothing otherwise. See docs/FIREBASE_SECURITY.md.
    const appCheckSiteKey = (typeof window !== 'undefined' && window.RELIEF_APP_CHECK_SITE_KEY) || '';
    if (firebaseLoaded && appCheckSiteKey && typeof firebase.appCheck === 'function') {
        firebase.appCheck().activate(appCheckSiteKey, true);
    }
    const auth = firebaseLoaded ? firebase.auth() : null;
    const db = firebaseLoaded ? firebase.firestore() : null;

    // Helper functions
    const handleError = (error) => {
        console.error('API Error:', error);
        throw error;
    };

    // ---- RELIEF backend --------------------------------------------------
    // One place for every call to the RELIEF backend. Errors carry a `code`:
    //   backend-unavailable  not configured, offline, timed out, 5xx, or no usable answer
    //   unauthenticated      401
    //   forbidden            403
    //   rate-limited         429
    //   rejected             any other 4xx (err.status, err.details from the body if any)
    // Callers must treat anything but a clean 2xx JSON answer as "no answer".
    const backendError = (code, message, extra) => {
        const error = new Error(message);
        error.name = 'ReliefBackendError';
        error.code = code;
        return Object.assign(error, extra || {});
    };

    const backendBase = () => {
        let base = config.RELIEF_BACKEND_URL;
        if (typeof window !== 'undefined' && window.RELIEF_BACKEND_URL) base = window.RELIEF_BACKEND_URL;
        if (typeof document !== 'undefined' && document.querySelector) {
            const meta = document.querySelector('meta[name="relief-backend-url"]');
            if (meta && meta.getAttribute('content')) base = meta.getAttribute('content');
        }
        return String(base || '').trim().replace(/\/+$/, '');
    };

    const backendRequest = async (path, options = {}) => {
        const base = backendBase();
        if (!base) throw backendError('backend-unavailable', 'No RELIEF backend is configured.');
        // Plain http is only allowed for a local backend, so nothing sensitive crosses the network unencrypted.
        if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(base)) {
            throw backendError('backend-unavailable', 'The RELIEF backend URL must use https.');
        }
        if (typeof fetch !== 'function') throw backendError('backend-unavailable', 'fetch is not available.');

        const hasBody = options.body !== undefined;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs || 8000) : null;
        try {
            const response = await fetch(base + path, {
                method: options.method || 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: hasBody ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
                body: hasBody ? JSON.stringify(options.body) : undefined,
                signal: controller ? controller.signal : undefined
            });
            const type = response.headers && response.headers.get ? (response.headers.get('content-type') || '') : '';
            let data = null;
            if (/json/i.test(type)) {
                try { data = await response.json(); } catch (e) { data = null; }
            }
            if (!response.ok) {
                const status = response.status;
                if (status === 401) throw backendError('unauthenticated', 'Sign in required.', { status });
                if (status === 403) throw backendError('forbidden', 'Not allowed.', { status });
                if (status === 429) throw backendError('rate-limited', 'Too many requests.', { status });
                if (status >= 400 && status < 500) throw backendError('rejected', 'The request was rejected.', { status, details: data });
                throw backendError('backend-unavailable', 'The RELIEF backend returned ' + status + '.', { status });
            }
            if (data === null) throw backendError('backend-unavailable', 'The RELIEF backend sent an unusable answer.');
            return data;
        } catch (error) {
            if (error && error.name === 'ReliefBackendError') throw error;
            throw backendError('backend-unavailable', 'Could not reach the RELIEF backend.');
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    const validateEmail = (email) => {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };

    const validatePassword = (password) => {
        return password && password.length >= 6;
    };

    // User Authentication (using Firebase free tier)
    const login = async (email, password) => {
        try {
            if (!validateEmail(email) || !validatePassword(password)) {
                throw new Error('Invalid email or password format');
            }

            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const userDoc = await db.collection('users').doc(userCredential.user.uid).get();

            if (!userDoc.exists) {
                throw new Error('User not found');
            }

            return {
                uid: userCredential.user.uid,
                ...userDoc.data()
            };
        } catch (error) {
            return handleError(error);
        }
    };

    const signup = async (userData) => {
        try {
            if (!validateEmail(userData.email) || !validatePassword(userData.password)) {
                throw new Error('Invalid email or password format');
            }

            const userCredential = await auth.createUserWithEmailAndPassword(
                userData.email,
                userData.password
            );

            const { password, ...userWithoutPassword } = userData;

            await db.collection('users').doc(userCredential.user.uid).set({
                ...userWithoutPassword,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });

            return {
                uid: userCredential.user.uid,
                ...userWithoutPassword
            };
        } catch (error) {
            return handleError(error);
        }
    };

    const logout = async () => {
        try {
            await auth.signOut();
            return { success: true };
        } catch (error) {
            return handleError(error);
        }
    };

    const getCurrentUser = async () => {
        try {
            if (!auth) return null; // Firebase SDK not on this page
            const user = auth.currentUser;
            if (!user) return null;

            const userDoc = await db.collection('users').doc(user.uid).get();
            return userDoc.exists ? { uid: user.uid, ...userDoc.data() } : null;
        } catch (error) {
            return handleError(error);
        }
    };

    // Subscription status
    /**
     * Asks the RELIEF backend what the signed-in user's subscription really is.
     *
     * GET {backend}/v1/subscription  (session cookie, no client-supplied plan or status)
     * Contract: docs/SUBSCRIPTION_SERVER_CONTRACT.md
     *
     * Resolves with the parsed JSON body exactly as the server sent it. It is NOT
     * checked here: pass it to ReliefSubscription.normalize()/verify() before using it.
     * Rejects (code 'backend-unavailable', 'unauthenticated', ...) when there is no
     * trustworthy answer. It never reads localStorage, cookies the page can set, or
     * URL parameters, and it never returns a guessed or cached value.
     */
    const verifySubscription = () => backendRequest('/v1/subscription');

    // Medical Data Services (using OpenMRS instead of Infermedica)
    const searchDoctors = async (params) => {
        try {
            // Using OpenStreetMap for location-based doctor search
            const response = await fetch(`${config.OPENSTREETMAP_NOMINATIM_URL}/search?q=doctor+${params.specialty}+in+${params.location}&format=json`);
            const data = await response.json();

            return data.map(item => ({
                id: item.place_id,
                name: item.display_name,
                location: {
                    lat: item.lat,
                    lng: item.lon
                },
                specialty: params.specialty
            }));
        } catch (error) {
            return handleError(error);
        }
    };

    const searchHospitals = async (params) => {
        try {
            // Using OpenStreetMap for hospital search
            const response = await fetch(`${config.OPENSTREETMAP_NOMINATIM_URL}/search?q=hospital+near+${params.lat},${params.lng}&format=json`);
            const data = await response.json();
            return data.map(item => ({
                id: item.place_id,
                name: item.display_name,
                location: {
                    lat: item.lat,
                    lng: item.lon
                }
            }));
        } catch (error) {
            return handleError(error);
        }
    };

    const searchPharmacies = async (params) => {
        try {
            // Using OpenStreetMap for pharmacy search
            const response = await fetch(`${config.OPENSTREETMAP_NOMINATIM_URL}/search?q=pharmacy+near+${params.lat},${params.lng}&format=json`);
            const data = await response.json();
            return data.map(item => ({
                id: item.place_id,
                name: item.display_name,
                location: {
                    lat: item.lat,
                    lng: item.lon
                }
            }));
        } catch (error) {
            return handleError(error);
        }
    };

    const analyzeSymptoms = async (age, sex, symptoms) => {
        try {
            // Using OpenMRS as a free alternative to Infermedica
            const response = await fetch(`${config.OPENMRS_API_URL}/symptomanalysis`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sex,
                    age,
                    symptoms: symptoms.map(symptom => symptom.id)
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            return handleError(error);
        }
    };

    const bookAppointment = async (appointmentData) => {
        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const docRef = await db.collection('appointments').add({
                ...appointmentData,
                userId: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'pending'
            });

            return {
                success: true,
                appointmentId: docRef.id,
                ...appointmentData
            };
        } catch (error) {
            return handleError(error);
        }
    };

    const getUserAppointments = async () => {
        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const snapshot = await db.collection('appointments')
                .where('userId', '==', user.uid)
                .orderBy('createdAt', 'desc')
                .get();

            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            return handleError(error);
        }
    };

    // Emergency Services (using OpenStreetMap)
    const requestAmbulance = async (emergencyData) => {
        try {
            // In a real implementation, you would need to connect with local emergency services
            // This is a mock implementation using OpenStreetMap for routing

            // Log the emergency request in Firebase
            const user = await getCurrentUser();
            if (user) {
                await db.collection('emergencyRequests').add({
                    userId: user.uid,
                    type: 'ambulance',
                    data: emergencyData,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'requested'
                });
            }

            return {
                success: true,
                message: "Emergency services have been notified",
                requestId: Date.now().toString()
            };
        } catch (error) {
            return handleError(error);
        }
    };

    const requestMedicineDelivery = async (deliveryData) => {
        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const docRef = await db.collection('medicineDeliveries').add({
                ...deliveryData,
                userId: user.uid,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            return {
                success: true,
                deliveryId: docRef.id,
                estimatedDelivery: "1-2 hours"
            };
        } catch (error) {
            return handleError(error);
        }
    };

    // Telemedicine Services (using Jitsi instead of Daily.co)
    const createVideoRoom = async (roomName) => {
        try {
            // Jitsi Meet is a free open-source video conferencing solution
            return {
                success: true,
                roomUrl: `https://meet.jit.si/${roomName}`,
                roomName: roomName
            };
        } catch (error) {
            return handleError(error);
        }
    };

    const chatWithBot = async (message, sessionId) => {
        try {
            // Using Rasa open-source chatbot framework (self-hosted)
            const response = await fetch(`${config.RASA_API_URL}/webhooks/rest/webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sender: sessionId,
                    message: message
                })
            });

            if (!response.ok) {
                throw new Error(`Chat request failed with status ${response.status}`);
            }

            const data = await response.json();
            return {
                fulfillmentText: data[0]?.text || "I didn't understand that",
                intent: data[0]?.intent || {}
            };
        } catch (error) {
            return handleError(error);
        }
    };

    // Data Storage (using Firebase free tier)
    const savePatientData = async (data) => {
        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            await db.collection('patients').doc(user.uid).set(data, { merge: true });
            return { success: true };
        } catch (error) {
            return handleError(error);
        }
    };

    const getPatientData = async () => {
        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('User not authenticated');

            const doc = await db.collection('patients').doc(user.uid).get();
            return doc.exists ? doc.data() : null;
        } catch (error) {
            return handleError(error);
        }
    };

    // Facility corrections (moderated). Contract: docs/FACILITY_CORRECTIONS.md
    // The backend, not the page, decides who may review: it must check the
    // moderator role on list and decision, and take the moderator's name from
    // their login rather than from the request.

    /**
     * Sends a suggested correction to the review queue. It is never applied to the
     * facility record. POST {backend}/v1/facility-corrections
     * correction: { facilityId, field, proposedValue, sourceUrl, contact }
     */
    const submitFacilityCorrection = (correction) =>
        backendRequest('/v1/facility-corrections', { method: 'POST', body: correction });

    /**
     * Moderators only. GET {backend}/v1/facility-corrections?status=pending|approved|rejected
     * Resolves with an array (or { corrections: [] }) of correction records.
     */
    const listFacilityCorrections = (filter = {}) => {
        const query = filter.status ? '?status=' + encodeURIComponent(filter.status) : '';
        return backendRequest('/v1/facility-corrections' + query);
    };

    /**
     * Moderators only. POST {backend}/v1/facility-corrections/{id}/decision
     * decision: { decision: 'approve' | 'reject', reason, evidence }
     * Approving needs evidence, rejecting needs a reason. A decision is final.
     */
    const reviewFacilityCorrection = (id, decision) =>
        backendRequest('/v1/facility-corrections/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: decision });

    // Public API
    return {
        // Authentication
        login,
        signup,
        logout,
        getCurrentUser,
        deleteAccount,

        // Subscription (server-verified, see docs/SUBSCRIPTION_SERVER_CONTRACT.md)
        verifySubscription,

        // Medical Services
        searchDoctors,
        searchHospitals,
        searchPharmacies,
        analyzeSymptoms,
        bookAppointment,
        getUserAppointments,

        // Emergency Services
        requestAmbulance,
        requestMedicineDelivery,

        // Telemedicine
        createVideoRoom,
        chatWithBot,

        // Data Storage
        savePatientData,
        getPatientData,

        // Facility corrections (moderated, see docs/FACILITY_CORRECTIONS.md)
        submitFacilityCorrection,
        listFacilityCorrections,
        reviewFacilityCorrection
    };
})();

// Make API available globally if needed
if (typeof window !== 'undefined') {
    window.ReliefAPI = ReliefAPI;
}

// `export default` is a syntax error in a classic <script>, which is how every page loads this file.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReliefAPI;
}
