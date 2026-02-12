document.addEventListener('DOMContentLoaded', function() {
    // Mock doctor data
    const doctors = [
        {
            id: 1,
            name: "Dr. Sarah Johnson",
            specialty: "Cardiologist",
            location: "Downtown Medical Center, 2.5 miles away",
            rating: 4.8,
            reviews: 124,
            availability: "Available today",
            image: "../assets/images/doctor1.jpg",
            bio: "Board-certified cardiologist with 10 years of experience specializing in heart health and preventive care."
        },
        {
            id: 2,
            name: "Dr. Michael Chen",
            specialty: "General Practitioner",
            location: "Westside Clinic, 1.2 miles away",
            rating: 4.6,
            reviews: 89,
            availability: "Available tomorrow",
            image: "../assets/images/doctor2.jpg",
            bio: "Primary care physician focused on family medicine and holistic patient care."
        },
        {
            id: 3,
            name: "Dr. Emily Rodriguez",
            specialty: "Pediatrician",
            location: "Children's Hospital, 3.1 miles away",
            rating: 4.9,
            reviews: 156,
            availability: "Available this week",
            image: "../assets/images/doctor3.jpg",
            bio: "Pediatric specialist with expertise in child development and preventive care."
        },
        {
            id: 4,
            name: "Dr. James Wilson",
            specialty: "Neurologist",
            location: "Neuro Center, 4.3 miles away",
            rating: 4.7,
            reviews: 72,
            availability: "Available next week",
            image: "../assets/images/doctor4.jpg",
            bio: "Neurology expert with focus on migraine treatment and cognitive disorders."
        },
        {
            id: 5,
            name: "Dr. Lisa Park",
            specialty: "Dermatologist",
            location: "Skin Health Clinic, 1.8 miles away",
            rating: 4.5,
            reviews: 98,
            availability: "Available today",
            image: "../assets/images/doctor5.jpg",
            bio: "Dermatology specialist with expertise in skin cancer prevention and cosmetic procedures."
        },
        {
            id: 6,
            name: "Dr. Robert Taylor",
            specialty: "Psychiatrist",
            location: "Mental Wellness Center, 2.7 miles away",
            rating: 4.4,
            reviews: 65,
            availability: "Available tomorrow",
            image: "../assets/images/doctor6.jpg",
            bio: "Psychiatrist specializing in anxiety, depression, and cognitive behavioral therapy."
        }
    ];

    // DOM elements
    const doctorsList = document.querySelector('.doctors-list');
    const searchInput = document.querySelector('.search-box input');
    const specialtyFilter = document.getElementById('specialty');
    const locationFilter = document.getElementById('location');
    const availabilityFilter = document.getElementById('availability');
    const filterButton = document.querySelector('.btn-filter');
    const sortSelect = document.querySelector('.sort-options select');

    // Display all doctors initially
    displayDoctors(doctors);

    // Filter doctors based on search and filters
    function filterDoctors() {
        const searchTerm = searchInput.value.toLowerCase();
        const specialty = specialtyFilter.value.toLowerCase();
        const location = locationFilter.value.toLowerCase();
        const availability = availabilityFilter.value;

        const filteredDoctors = doctors.filter(doctor => {
            const matchesSearch =
                doctor.name.toLowerCase().includes(searchTerm) ||
                doctor.specialty.toLowerCase().includes(searchTerm) ||
                doctor.bio.toLowerCase().includes(searchTerm);

            const matchesSpecialty = !specialty || doctor.specialty.toLowerCase() === specialty;
            const matchesLocation = !location || doctor.location.toLowerCase().includes(location);
            const matchesAvailability = !availability ||
                (availability === 'today' && doctor.availability.toLowerCase().includes('today')) ||
                (availability === 'tomorrow' && doctor.availability.toLowerCase().includes('tomorrow')) ||
                (availability === 'week' && (doctor.availability.toLowerCase().includes('week') ||
                                           doctor.availability.toLowerCase().includes('this week') ||
                                           doctor.availability.toLowerCase().includes('next week')));

            return matchesSearch && matchesSpecialty && matchesLocation && matchesAvailability;
        });

        displayDoctors(filteredDoctors);
    }

    // Sort doctors
    function sortDoctors(doctorsList, sortBy) {
        return [...doctorsList].sort((a, b) => {
            if (sortBy === 'rating') {
                return b.rating - a.rating;
            } else if (sortBy === 'availability') {
                // Enhanced sorting based on availability
                const availabilityOrder = {
                    'today': 1,
                    'tomorrow': 2,
                    'this week': 3,
                    'next week': 4
                };

                const aAvail = a.availability.toLowerCase();
                const bAvail = b.availability.toLowerCase();

                const aOrder = availabilityOrder[
                    aAvail.includes('today') ? 'today' :
                    aAvail.includes('tomorrow') ? 'tomorrow' :
                    aAvail.includes('this week') ? 'this week' :
                    aAvail.includes('next week') ? 'next week' : 5
                ];

                const bOrder = availabilityOrder[
                    bAvail.includes('today') ? 'today' :
                    bAvail.includes('tomorrow') ? 'tomorrow' :
                    bAvail.includes('this week') ? 'this week' :
                    bAvail.includes('next week') ? 'next week' : 5
                ];

                return aOrder - bOrder;
            } else {
                // Default sort by distance (mock implementation)
                const extractDistance = (location) => {
                    const match = location.match(/(\d+\.?\d*)\s*miles/);
                    return match ? parseFloat(match[1]) : Infinity;
                };

                const aDistance = extractDistance(a.location);
                const bDistance = extractDistance(b.location);
                return aDistance - bDistance;
            }
        });
    }

    // Display doctors in the UI
    function displayDoctors(doctorsToDisplay) {
        doctorsList.innerHTML = '';

        if (doctorsToDisplay.length === 0) {
            doctorsList.innerHTML = '<p class="no-results">No doctors found matching your criteria.</p>';
            return;
        }

        const sortBy = sortSelect.value;
        const sortedDoctors = sortDoctors(doctorsToDisplay, sortBy);

        sortedDoctors.forEach(doctor => {
            const doctorCard = document.createElement('div');
            doctorCard.className = 'doctor-card';
            doctorCard.innerHTML = `
                <div class="doctor-image" style="background-image: url('${doctor.image}')"></div>
                <div class="doctor-info">
                    <h4 class="doctor-name">${doctor.name}</h4>
                    <p class="doctor-specialty">${doctor.specialty}</p>
                    <p class="doctor-location"><i class="fas fa-map-marker-alt"></i> ${doctor.location}</p>
                    <div class="doctor-rating">
                        <div class="stars">
                            ${'<i class="fas fa-star"></i>'.repeat(Math.floor(doctor.rating))}
                            ${doctor.rating % 1 >= 0.5 ? '<i class="fas fa-star-half-alt"></i>' : ''}
                            ${'<i class="far fa-star"></i>'.repeat(5 - Math.ceil(doctor.rating))}
                        </div>
                        <span class="reviews">(${doctor.reviews} reviews)</span>
                    </div>
                    <p class="doctor-bio">${doctor.bio}</p>
                    <div class="doctor-availability">
                        <span class="availability-badge">${doctor.availability}</span>
                        <button class="btn-book" data-id="${doctor.id}">Book Appointment</button>
                    </div>
                </div>
            `;
            doctorsList.appendChild(doctorCard);
        });

        // Add event listeners to book buttons
        document.querySelectorAll('.btn-book').forEach(button => {
            button.addEventListener('click', function() {
                const doctorId = this.getAttribute('data-id');
                bookAppointment(doctorId);
            });
        });
    }

    // Book appointment function
    function bookAppointment(doctorId) {
        const doctor = doctors.find(d => d.id == doctorId);
        if (!doctor) return;

        // In a real app, this would redirect to a booking page or show a modal
        alert(`Booking appointment with ${doctor.name}\nSpecialty: ${doctor.specialty}\nLocation: ${doctor.location}`);

        // For demo purposes, we'll store the selected doctor in localStorage
        localStorage.setItem('selectedDoctor', JSON.stringify(doctor));

        // Redirect to appointments page
        window.location.href = '../pages/appointments.html';
    }

    // Event listeners
    searchInput.addEventListener('input', filterDoctors);
    filterButton.addEventListener('click', filterDoctors);
    sortSelect.addEventListener('change', () => {
        const currentDoctors = Array.from(document.querySelectorAll('.doctor-card')).length > 0 ?
            doctors :
            JSON.parse(JSON.stringify(doctors));
        displayDoctors(currentDoctors);
    });

    // Initialize with filtered doctors
    filterDoctors();
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
