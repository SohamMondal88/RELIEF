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
        RASA_API_URL: 'http://localhost:5005' // Self-hosted
    };

    // Initialize Firebase if it hasn't been initialized already
    if (!firebase.apps.length) {
        firebase.initializeApp(config.FIREBASE_CONFIG);
    }
    const auth = firebase.auth();
    const db = firebase.firestore();

    // Helper functions
    const handleError = (error) => {
        console.error('API Error:', error);
        throw error;
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
            const user = auth.currentUser;
            if (!user) return null;
            
            const userDoc = await db.collection('users').doc(user.uid).get();
            return userDoc.exists ? { uid: user.uid, ...userDoc.data() } : null;
        } catch (error) {
            return handleError(error);
        }
    };

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

    // Public API
    return {
        // Authentication
        login,
        signup,
        logout,
        getCurrentUser,
        
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
        getPatientData
    };
})();

// Make API available globally if needed
if (typeof window !== 'undefined') {
    window.ReliefAPI = ReliefAPI;
}

export default ReliefAPI;