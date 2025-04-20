document.addEventListener('DOMContentLoaded', function() {
    // Get selected doctor from localStorage
    const selectedDoctor = JSON.parse(localStorage.getItem('selectedDoctor'));
    if (!selectedDoctor) {
        alert('No doctor selected. Please select a doctor first.');
        window.location.href = '../pages/doctors.html';
        return;
    }

    // Appointment data
    let appointmentData = {
        doctor: selectedDoctor,
        date: null,
        time: null,
        patientInfo: null,
        videoUrl: null
    };

    // DOM elements
    const doctorSummary = document.querySelector('.doctor-summary');
    const datePicker = document.querySelector('.date-picker');
    const timeSlots = document.querySelector('.time-slots');
    const appointmentSummary = document.querySelector('.appointment-summary');
    const steps = document.querySelectorAll('.form-step');
    const stepIndicators = document.querySelectorAll('.booking-steps .step');
    let currentStep = 0;

    // Initialize the page
    displayDoctorInfo();
    generateDateOptions();
    showStep(currentStep);

    // Display doctor information
    function displayDoctorInfo() {
        doctorSummary.innerHTML = `
            <div class="doctor-image" style="background-image: url('${appointmentData.doctor.image}')"></div>
            <div class="doctor-details">
                <h3>${appointmentData.doctor.name}</h3>
                <p class="doctor-specialty">${appointmentData.doctor.specialty}</p>
                <p class="doctor-location"><i class="fas fa-map-marker-alt"></i> ${appointmentData.doctor.location}</p>
                <div class="doctor-rating">
                    <div class="stars">
                        ${'<i class="fas fa-star"></i>'.repeat(Math.floor(appointmentData.doctor.rating))}
                        ${appointmentData.doctor.rating % 1 >= 0.5 ? '<i class="fas fa-star-half-alt"></i>' : ''}
                    </div>
                    <span>${appointmentData.doctor.reviews} reviews</span>
                </div>
            </div>
        `;
    }

    // Generate date options for the next 7 days
    function generateDateOptions() {
        datePicker.innerHTML = '';
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            
            const dayName = days[date.getDay()];
            const day = date.getDate();
            const month = months[date.getMonth()];

            const dateOption = document.createElement('div');
            dateOption.className = 'date-option';
            dateOption.innerHTML = `
                <div class="day">${day}</div>
                <div class="month">${month}</div>
                <div class="day-name">${dayName}</div>
            `;
            
            dateOption.addEventListener('click', function() {
                document.querySelectorAll('.date-option').forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                
                // Store selected date
                appointmentData.date = new Date(date); // Create new Date object to avoid reference issues
                
                // Generate time slots for selected date
                generateTimeSlots(appointmentData.date);
            });

            datePicker.appendChild(dateOption);
        }
    }

    // Generate time slots for a selected date
    function generateTimeSlots(date) {
        timeSlots.innerHTML = '';
        
        // Determine if it's today or future date
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        const currentHour = today.getHours();
        
        // Generate time slots (every 30 minutes from 9AM to 5PM)
        for (let hour = 9; hour <= 17; hour++) {
            // Skip past times if it's today
            if (isToday && hour < currentHour) continue;
            
            // Add full hour slot
            const fullHour = document.createElement('div');
            fullHour.className = 'time-slot';
            fullHour.textContent = `${hour}:00`;
            fullHour.addEventListener('click', function() {
                document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('active'));
                this.classList.add('active');
                appointmentData.time = `${hour}:00`;
            });
            timeSlots.appendChild(fullHour);
            
            // Add half hour slot (except for 5PM)
            if (hour < 17) {
                const halfHour = document.createElement('div');
                halfHour.className = 'time-slot';
                halfHour.textContent = `${hour}:30`;
                halfHour.addEventListener('click', function() {
                    document.querySelectorAll('.time-slot').forEach(slot => slot.classList.remove('active'));
                    this.classList.add('active');
                    appointmentData.time = `${hour}:30`;
                });
                timeSlots.appendChild(halfHour);
            }
        }
    }

    // Show current step
    function showStep(stepIndex) {
        steps.forEach((step, index) => {
            step.classList.toggle('active', index === stepIndex);
        });
        
        // Update step indicators
        stepIndicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === stepIndex);
            indicator.classList.toggle('completed', index < stepIndex);
        });
        
        // Update summary in step 3
        if (stepIndex === 2) {
            updateAppointmentSummary();
        }
    }

    // Update appointment summary
    function updateAppointmentSummary() {
        if (!appointmentData.date || !appointmentData.time) {
            alert('Please select a date and time for your appointment');
            currentStep = 1;
            showStep(currentStep);
            return;
        }
        
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = appointmentData.date.toLocaleDateString('en-US', options);
        
        appointmentSummary.innerHTML = `
            <div class="summary-item">
                <span class="summary-label">Doctor:</span>
                <span>${appointmentData.doctor.name}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Specialty:</span>
                <span>${appointmentData.doctor.specialty}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Date:</span>
                <span>${formattedDate}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Time:</span>
                <span>${appointmentData.time}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Location:</span>
                <span>${appointmentData.doctor.location}</span>
            </div>
        `;
    }

    // Next button click handler
    document.querySelectorAll('.btn-next').forEach(button => {
        button.addEventListener('click', function() {
            // Validate current step before proceeding
            if (currentStep === 1 && (!appointmentData.date || !appointmentData.time)) {
                alert('Please select a date and time for your appointment');
                return;
            }
            
            if (currentStep < steps.length - 1) {
                currentStep++;
                showStep(currentStep);
            }
        });
    });
    
    // Previous button click handler
    document.querySelectorAll('.btn-prev').forEach(button => {
        button.addEventListener('click', function() {
            if (currentStep > 0) {
                currentStep--;
                showStep(currentStep);
            }
        });
    });

    let callFrame;

    function startVideoCall(roomUrl) {
        callFrame = window.DailyIframe.createFrame({
            iframeStyle: {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '9999'
            }
        });
        
        callFrame.join({ url: roomUrl });
        
        // Add button to end call
        const endCallBtn = document.createElement('button');
        endCallBtn.textContent = 'End Call';
        endCallBtn.style.position = 'fixed';
        endCallBtn.style.bottom = '20px';
        endCallBtn.style.left = '50%';
        endCallBtn.style.transform = 'translateX(-50%)';
        endCallBtn.style.zIndex = '10000';
        endCallBtn.style.padding = '10px 20px';
        endCallBtn.style.backgroundColor = '#ff4444';
        endCallBtn.style.color = 'white';
        endCallBtn.style.border = 'none';
        endCallBtn.style.borderRadius = '5px';
        endCallBtn.style.cursor = 'pointer';
        
        endCallBtn.onclick = () => {
            callFrame.leave();
            document.body.removeChild(endCallBtn);
            window.location.href = '../index.html';
        };
        document.body.appendChild(endCallBtn);
    }
    
    // Combined confirm appointment handler
    document.querySelector('.btn-confirm')?.addEventListener('click', function() {
        // Validate patient form
        const patientName = document.getElementById('patient-name').value.trim();
        const patientEmail = document.getElementById('patient-email').value.trim();
        const patientPhone = document.getElementById('patient-phone').value.trim();
        
        if (!patientName || !patientEmail || !patientPhone) {
            alert('Please fill in all required patient information');
            return;
        }
        
        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) {
            alert('Please enter a valid email address');
            return;
        }
        
        // Store patient info
        appointmentData.patientInfo = {
            name: patientName,
            email: patientEmail,
            phone: patientPhone,
            notes: document.getElementById('patient-notes').value.trim()
        };
        
        // Create video room URL (simulated - in real app you'd call your backend)
        const roomName = `appointment-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        appointmentData.videoUrl = `https://your-video-service.com/${roomName}`;
        
        // In a real app, you would send this data to your backend
        console.log('Appointment data:', appointmentData);
        
        // Store appointment in localStorage
        let appointments = JSON.parse(localStorage.getItem('appointments') || '[]');
        appointments.push(appointmentData);
        localStorage.setItem('appointments', JSON.stringify(appointments));
        
        // Start the video call
        startVideoCall(appointmentData.videoUrl);
        
        // Show confirmation (this won't show if video call starts immediately)
        alert(`Appointment booked successfully with ${appointmentData.doctor.name} on ${appointmentData.date.toDateString()} at ${appointmentData.time}`);
    });
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