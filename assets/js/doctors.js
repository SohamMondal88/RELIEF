document.addEventListener('DOMContentLoaded', function() {
    // Sample doctor data. It has no ratings, review counts, availability or distances on purpose: none of that is known.
    const doctors = [
        {
            id: 1,
            name: "Dr. Sarah Johnson",
            specialty: "Cardiologist",
            location: "Downtown Medical Center",
            image: "../assets/images/doctor1.jpg",
            bio: "Board-certified cardiologist with 10 years of experience specializing in heart health and preventive care."
        },
        {
            id: 2,
            name: "Dr. Michael Chen",
            specialty: "General Practitioner",
            location: "Westside Clinic",
            image: "../assets/images/doctor2.jpg",
            bio: "Primary care physician focused on family medicine and holistic patient care."
        },
        {
            id: 3,
            name: "Dr. Emily Rodriguez",
            specialty: "Pediatrician",
            location: "Children's Hospital",
            image: "../assets/images/doctor3.jpg",
            bio: "Pediatric specialist with expertise in child development and preventive care."
        },
        {
            id: 4,
            name: "Dr. James Wilson",
            specialty: "Neurologist",
            location: "Neuro Center",
            image: "../assets/images/doctor4.jpg",
            bio: "Neurology expert with focus on migraine treatment and cognitive disorders."
        },
        {
            id: 5,
            name: "Dr. Lisa Park",
            specialty: "Dermatologist",
            location: "Skin Health Clinic",
            image: "../assets/images/doctor5.jpg",
            bio: "Dermatology specialist with expertise in skin cancer prevention and cosmetic procedures."
        },
        {
            id: 6,
            name: "Dr. Robert Taylor",
            specialty: "Psychiatrist",
            location: "Mental Wellness Center",
            image: "../assets/images/doctor6.jpg",
            bio: "Psychiatrist specializing in anxiety, depression, and cognitive behavioral therapy."
        }
    ];

    // DOM elements
    const doctorsList = document.querySelector('.doctors-list');
    const searchInput = document.querySelector('.search-box input');
    const specialtyFilter = document.getElementById('specialty');
    const locationFilter = document.getElementById('location');
    const filterButton = document.querySelector('.btn-filter');
    const sortSelect = document.querySelector('.sort-options select');
    const statusEl = document.getElementById('directory-status');
    const U = window.FacilityUtils || null;

    function setStatus(message) {
        if (statusEl) statusEl.textContent = message;
    }

    // Display all doctors initially
    displayDoctors(doctors);

    // Filter doctors based on search and filters
    function filterDoctors() {
        const searchTerm = searchInput.value.toLowerCase();
        const specialty = specialtyFilter.value.toLowerCase();
        const location = locationFilter.value.toLowerCase();

        const filteredDoctors = doctors.filter(doctor => {
            const matchesSearch =
                doctor.name.toLowerCase().includes(searchTerm) ||
                doctor.specialty.toLowerCase().includes(searchTerm) ||
                doctor.bio.toLowerCase().includes(searchTerm);

            const matchesSpecialty = !specialty || doctor.specialty.toLowerCase() === specialty;
            const matchesLocation = !location || doctor.location.toLowerCase().includes(location);

            return matchesSearch && matchesSpecialty && matchesLocation;
        });

        displayDoctors(filteredDoctors);
    }

    // Sort doctors. Only fields that are really in the data are used, and the order is the same every time:
    // equal values fall back to name and then id.
    function sortDoctors(list, sortBy) {
        const byName = U ? U.compareNames : (a, b) => a.name.localeCompare(b.name);
        return [...list].sort((a, b) => {
            if (sortBy === 'specialty') {
                const bySpecialty = a.specialty.localeCompare(b.specialty, 'en', { sensitivity: 'base' });
                if (bySpecialty !== 0) return bySpecialty;
            }
            return byName(a, b);
        });
    }

    // Display doctors in the UI
    function displayDoctors(doctorsToDisplay) {
        doctorsList.innerHTML = '';

        if (doctorsToDisplay.length === 0) {
            doctorsList.innerHTML = '<p class="no-results">No doctors found matching your criteria.</p>';
            setStatus('No doctors found.');
            return;
        }

        const sortBy = sortSelect.value === 'specialty' ? 'specialty' : 'name';
        const sortedDoctors = sortDoctors(doctorsToDisplay, sortBy);
        setStatus(doctorsToDisplay.length + (doctorsToDisplay.length === 1 ? ' doctor found. ' : ' doctors found. ') +
            (sortBy === 'specialty' ? 'Sorted by specialty, then name.' : 'Sorted by name, A to Z.'));

        sortedDoctors.forEach(doctor => {
            const doctorCard = document.createElement('div');
            doctorCard.className = 'doctor-card';
            doctorCard.innerHTML = `
                <div class="doctor-image" style="background-image: url('${doctor.image}')"></div>
                <div class="doctor-info">
                    <h4 class="doctor-name">${doctor.name}</h4>
                    <p class="doctor-specialty">${doctor.specialty}</p>
                    <p class="doctor-location"><i class="fas fa-map-marker-alt"></i> ${doctor.location}</p>
                    <p class="doctor-bio">${doctor.bio}</p>
                    <div class="doctor-availability">
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
    // Selects filter as soon as they change, like the hospitals page; the Filter button still works too.
    [specialtyFilter, locationFilter].forEach(el => el.addEventListener('change', filterDoctors));
    sortSelect.addEventListener('change', filterDoctors);

    // Initialize with filtered doctors
    filterDoctors();
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
