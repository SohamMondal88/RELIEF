document.addEventListener('DOMContentLoaded', function() {
    // Mock pharmacy data
    const pharmacies = [
        {
            id: 1,
            name: "City Pharmacy",
            type: "Chain Pharmacy",
            location: "123 Main St, Downtown, 1.2 miles away",
            services: ["Home Delivery", "Vaccines"],
            phone: "+1 555 123 4567",
            hours: {
                monFri: "8:00 AM - 10:00 PM",
                sat: "9:00 AM - 8:00 PM",
                sun: "10:00 AM - 6:00 PM"
            },
            rating: 4.5,
            lat: 40.7128,
            lng: -74.0060,
            image: "../assets/images/pharmacy1.jpg"
        },
        {
            id: 2,
            name: "24-Hour Drug Mart",
            type: "24-Hour",
            location: "456 Oak Ave, Westside, 2.5 miles away",
            services: ["24-Hour", "Home Delivery", "Compounding"],
            phone: "+1 555 234 5678",
            hours: {
                monFri: "Open 24 hours",
                sat: "Open 24 hours",
                sun: "Open 24 hours"
            },
            rating: 4.2,
            lat: 40.7328,
            lng: -74.0260,
            image: "../assets/images/pharmacy2.jpg"
        },
        {
            id: 3,
            name: "Greenleaf Pharmacy",
            type: "Independent",
            location: "789 Pine Rd, Northside, 1.8 miles away",
            services: ["Compounding", "Vaccines"],
            phone: "+1 555 345 6789",
            hours: {
                monFri: "9:00 AM - 7:00 PM",
                sat: "9:00 AM - 5:00 PM",
                sun: "Closed"
            },
            rating: 4.7,
            lat: 40.7528,
            lng: -74.0160,
            image: "../assets/images/pharmacy3.jpg"
        },
        {
            id: 4,
            name: "General Hospital Pharmacy",
            type: "Hospital Pharmacy",
            location: "321 Elm Blvd, Eastside, 3.2 miles away",
            services: ["Specialty Medications"],
            phone: "+1 555 456 7890",
            hours: {
                monFri: "8:00 AM - 8:00 PM",
                sat: "9:00 AM - 5:00 PM",
                sun: "10:00 AM - 4:00 PM"
            },
            rating: 4.3,
            lat: 40.7028,
            lng: -73.9960,
            image: "../assets/images/pharmacy4.jpg"
        },
        {
            id: 5,
            name: "QuickCare Pharmacy",
            type: "Chain Pharmacy",
            location: "654 Maple St, Downtown, 0.7 miles away",
            services: ["Home Delivery", "Vaccines"],
            phone: "+1 555 567 8901",
            hours: {
                monFri: "7:00 AM - 11:00 PM",
                sat: "8:00 AM - 10:00 PM",
                sun: "9:00 AM - 8:00 PM"
            },
            rating: 4.1,
            lat: 40.7128,
            lng: -74.0160,
            image: "../assets/images/pharmacy5.jpg"
        },
        {
            id: 6,
            name: "Southside Drugs",
            type: "Independent",
            location: "987 Cedar Ln, Southside, 4.0 miles away",
            services: ["Compounding"],
            phone: "+1 555 678 9012",
            hours: {
                monFri: "8:30 AM - 6:30 PM",
                sat: "9:00 AM - 4:00 PM",
                sun: "Closed"
            },
            rating: 4.4,
            lat: 40.6928,
            lng: -74.0360,
            image: "../assets/images/pharmacy6.jpg"
        }
    ];

    // DOM elements
    const pharmaciesList = document.querySelector('.pharmacies-list');
    const searchInput = document.querySelector('.search-box input');
    const pharmacyTypeFilter = document.getElementById('pharmacy-type');
    const locationFilter = document.getElementById('location');
    const servicesFilter = document.getElementById('services');
    const filterButton = document.querySelector('.btn-filter');
    const sortSelect = document.querySelector('.sort-options select');

    // Initialize map
    let map;
    let markers = [];

    function initMap() {
        // Use user's location if available, or default to a central location
        const userLocation = JSON.parse(localStorage.getItem('userLocation'));
        const center = userLocation ? [userLocation.lat, userLocation.lng] : [40.7128, -74.0060]; // Default to New York

        map = L.map('map').setView(center, 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add marker for user's location if available
        if (userLocation) {
            L.marker([userLocation.lat, userLocation.lng])
                .addTo(map)
                .bindPopup('Your Location')
                .openPopup();
        }
    }

    function updateMapMarkers(pharmaciesToShow) {
        // Clear existing markers
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];

        // Add new markers
        pharmaciesToShow.forEach(pharmacy => {
            const marker = L.marker([pharmacy.lat, pharmacy.lng])
                .addTo(map)
                .bindPopup(`<b>${pharmacy.name}</b><br>${pharmacy.location}`);

            markers.push(marker);
        });

        // Adjust map view to show all markers if there are any
        if (pharmaciesToShow.length > 0) {
            const markerGroup = new L.featureGroup(markers);
            map.fitBounds(markerGroup.getBounds().pad(0.2));
        }
    }

    // Filter pharmacies based on search and filters
    function filterPharmacies() {
        const searchTerm = searchInput.value.toLowerCase();
        const pharmacyType = pharmacyTypeFilter.value;
        const location = locationFilter.value;
        const services = servicesFilter.value;

        const filteredPharmacies = pharmacies.filter(pharmacy => {
            const matchesSearch =
                pharmacy.name.toLowerCase().includes(searchTerm) ||
                pharmacy.location.toLowerCase().includes(searchTerm);

            const matchesPharmacyType = !pharmacyType || pharmacy.type.toLowerCase() === pharmacyType.toLowerCase().replace('-', ' ');
            const matchesLocation = !location || pharmacy.location.toLowerCase().includes(location.toLowerCase());
            const matchesServices = !services || pharmacy.services.some(s =>
                s.toLowerCase().includes(services.toLowerCase().replace('-', ' ')));

            return matchesSearch && matchesPharmacyType && matchesLocation && matchesServices;
        });

        displayPharmacies(filteredPharmacies);
        updateMapMarkers(filteredPharmacies);
    }

    // Sort pharmacies
    function sortPharmacies(pharmaciesList, sortBy) {
        return [...pharmaciesList].sort((a, b) => {
            if (sortBy === 'rating') {
                return b.rating - a.rating;
            } else if (sortBy === 'delivery') {
                // Sort by delivery availability
                const aHasDelivery = a.services.includes("Home Delivery");
                const bHasDelivery = b.services.includes("Home Delivery");
                if (aHasDelivery && !bHasDelivery) return -1;
                if (!aHasDelivery && bHasDelivery) return 1;
                return 0;
            } else {
                // Default sort by distance (mock implementation)
                const aDistance = parseFloat(a.location.match(/\d+\.\d+|\d+/)[0]);
                const bDistance = parseFloat(b.location.match(/\d+\.\d+|\d+/)[0]);
                return aDistance - bDistance;
            }
        });
    }

    // Display pharmacies in the UI
    function displayPharmacies(pharmaciesToDisplay) {
        pharmaciesList.innerHTML = '';

        if (pharmaciesToDisplay.length === 0) {
            pharmaciesList.innerHTML = '<p class="no-results">No pharmacies found matching your criteria.</p>';
            return;
        }

        const sortBy = sortSelect.value;
        const sortedPharmacies = sortPharmacies(pharmaciesToDisplay, sortBy);

        sortedPharmacies.forEach(pharmacy => {
            const pharmacyCard = document.createElement('div');
            pharmacyCard.className = 'pharmacy-card';
            pharmacyCard.innerHTML = `
                <div class="pharmacy-image" style="background-image: url('${pharmacy.image}')"></div>
                <div class="pharmacy-info">
                    <h4 class="pharmacy-name">${pharmacy.name}</h4>
                    <p class="pharmacy-type">${pharmacy.type}</p>
                    <p class="pharmacy-location"><i class="fas fa-map-marker-alt"></i> ${pharmacy.location}</p>
                    <div class="pharmacy-services">
                        ${pharmacy.services.map(service =>
                            `<span class="service-tag">${service}</span>`
                        ).join('')}
                    </div>
                    <div class="pharmacy-hours">
                        <div class="hours-item">
                            <span>Mon-Fri:</span>
                            <span>${pharmacy.hours.monFri}</span>
                        </div>
                        <div class="hours-item">
                            <span>Sat:</span>
                            <span>${pharmacy.hours.sat}</span>
                        </div>
                        <div class="hours-item">
                            <span>Sun:</span>
                            <span>${pharmacy.hours.sun}</span>
                        </div>
                    </div>
                    <div class="pharmacy-actions">
                        <button class="btn-delivery" data-id="${pharmacy.id}">
                            <i class="fas fa-truck"></i> Request Delivery
                        </button>
                        <button class="btn-call" data-phone="${pharmacy.phone}">
                            <i class="fas fa-phone"></i> Call
                        </button>
                    </div>
                </div>
            `;
            pharmaciesList.appendChild(pharmacyCard);
        });

        // Add event listeners to buttons
        document.querySelectorAll('.btn-delivery').forEach(button => {
            button.addEventListener('click', function() {
                const pharmacyId = parseInt(this.getAttribute('data-id'));
                requestDelivery(pharmacyId);
            });
        });

        document.querySelectorAll('.btn-call').forEach(button => {
            button.addEventListener('click', function() {
                const phone = this.getAttribute('data-phone');
                // In a real app, this would initiate a phone call
                alert(`Calling ${phone}`);
            });
        });
    }

    // Request delivery function
    function requestDelivery(pharmacyId) {
        const pharmacy = pharmacies.find(p => p.id === pharmacyId);
        if (!pharmacy) return;

        // Check if pharmacy offers delivery
        if (!pharmacy.services.includes("Home Delivery")) {
            alert("This pharmacy doesn't offer home delivery service.");
            return;
        }

        // In a real app, this would open a delivery request form
        alert(`Requesting delivery from ${pharmacy.name}\nPhone: ${pharmacy.phone}\nLocation: ${pharmacy.location}`);
    }

    // Event listeners
    searchInput.addEventListener('input', filterPharmacies);
    filterButton.addEventListener('click', filterPharmacies);
    sortSelect.addEventListener('change', () => {
        filterPharmacies();
    });

    // Initialize with all pharmacies
    displayPharmacies(pharmacies);
    initMap();
    updateMapMarkers(pharmacies);
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
