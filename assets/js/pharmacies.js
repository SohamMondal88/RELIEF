document.addEventListener('DOMContentLoaded', function() {
    // Sample pharmacy data (not real pharmacies). It has no ratings or distances on purpose: none of that is known.
    const pharmacies = [
        {
            id: 1,
            name: "City Pharmacy",
            type: "Chain Pharmacy",
            location: "123 Main St, Downtown",
            services: ["Home Delivery", "Vaccines"],
            phone: "+1 555 123 4567",
            hours: {
                monFri: "8:00 AM - 10:00 PM",
                sat: "9:00 AM - 8:00 PM",
                sun: "10:00 AM - 6:00 PM"
            },
            lat: 40.7128,
            lng: -74.0060,
            image: "../assets/images/pharmacy1.jpg"
        },
        {
            id: 2,
            name: "24-Hour Drug Mart",
            type: "24-Hour",
            location: "456 Oak Ave, Westside",
            services: ["24-Hour", "Home Delivery", "Compounding"],
            phone: "+1 555 234 5678",
            hours: {
                monFri: "Open 24 hours",
                sat: "Open 24 hours",
                sun: "Open 24 hours"
            },
            lat: 40.7328,
            lng: -74.0260,
            image: "../assets/images/pharmacy2.jpg"
        },
        {
            id: 3,
            name: "Greenleaf Pharmacy",
            type: "Independent",
            location: "789 Pine Rd, Northside",
            services: ["Compounding", "Vaccines"],
            phone: "+1 555 345 6789",
            hours: {
                monFri: "9:00 AM - 7:00 PM",
                sat: "9:00 AM - 5:00 PM",
                sun: "Closed"
            },
            lat: 40.7528,
            lng: -74.0160,
            image: "../assets/images/pharmacy3.jpg"
        },
        {
            id: 4,
            name: "General Hospital Pharmacy",
            type: "Hospital Pharmacy",
            location: "321 Elm Blvd, Eastside",
            services: ["Specialty Medications"],
            phone: "+1 555 456 7890",
            hours: {
                monFri: "8:00 AM - 8:00 PM",
                sat: "9:00 AM - 5:00 PM",
                sun: "10:00 AM - 4:00 PM"
            },
            lat: 40.7028,
            lng: -73.9960,
            image: "../assets/images/pharmacy4.jpg"
        },
        {
            id: 5,
            name: "QuickCare Pharmacy",
            type: "Chain Pharmacy",
            location: "654 Maple St, Downtown",
            services: ["Home Delivery", "Vaccines"],
            phone: "+1 555 567 8901",
            hours: {
                monFri: "7:00 AM - 11:00 PM",
                sat: "8:00 AM - 10:00 PM",
                sun: "9:00 AM - 8:00 PM"
            },
            lat: 40.7128,
            lng: -74.0160,
            image: "../assets/images/pharmacy5.jpg"
        },
        {
            id: 6,
            name: "Southside Drugs",
            type: "Independent",
            location: "987 Cedar Ln, Southside",
            services: ["Compounding"],
            phone: "+1 555 678 9012",
            hours: {
                monFri: "8:30 AM - 6:30 PM",
                sat: "9:00 AM - 4:00 PM",
                sun: "Closed"
            },
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
    const statusEl = document.getElementById('directory-status');
    const U = window.FacilityUtils;

    function setStatus(message) {
        if (statusEl) statusEl.textContent = message;
    }

    // Initialize map
    let map;
    let markers = [];
    let userMarker = null;
    const DEFAULT_CENTER = [22.9868, 87.8550]; // West Bengal, used when no location is saved

    // Returns [lat, lng] from the saved location, or null.
    function getUserLocation() {
        const saved = window.ReliefLocation ? window.ReliefLocation.loadLocation() : null;
        return saved ? [saved.lat, saved.lng] : null;
    }

    function setUserMarker(location) {
        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }
        if (location) {
            userMarker = L.marker(location).addTo(map).bindPopup('Your Location');
        }
    }

    document.addEventListener('relief:location-changed', function() {
        // A new location changes the distances and the distance order.
        filterPharmacies();
        if (!map) return;
        const location = getUserLocation();
        setUserMarker(location);
        map.setView(location || DEFAULT_CENTER, location ? 13 : 7);
    });

    function initMap() {
        // Use the saved location if there is one, otherwise a West Bengal overview
        const userLocation = getUserLocation();
        const center = userLocation || DEFAULT_CENTER;

        map = L.map('map').setView(center, userLocation ? 13 : 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add marker for user's location if available
        setUserMarker(userLocation);
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

            const matchesPharmacyType = !pharmacyType || pharmacy.type.toLowerCase() === pharmacyType.toLowerCase();
            const matchesLocation = !location || pharmacy.location.toLowerCase().includes(location.toLowerCase());
            const matchesServices = !services || pharmacy.services.some(s =>
                s.toLowerCase().includes(services.toLowerCase().replace('-', ' ')));

            return matchesSearch && matchesPharmacyType && matchesLocation && matchesServices;
        });

        displayPharmacies(filteredPharmacies);
        updateMapMarkers(filteredPharmacies);
    }

    // Sort pharmacies. Only fields that are really in the data are used and the order is the same every time:
    // distance (only from a valid saved location, entries without a valid position last), home delivery
    // (listed in services), or name. Ties fall back to name and then id.
    function sortPharmacies(list, sortBy) {
        const saved = window.ReliefLocation ? window.ReliefLocation.loadLocation() : null;
        const origin = saved ? { lat: saved.lat, lng: saved.lng } : null;
        // This pass also adds distanceKm (null when the position is missing or invalid).
        const sorted = U.sortFacilities(list, sortBy === 'distance' ? 'distance' : 'name', origin);
        if (sortBy === 'delivery') {
            const offers = p => p.services.includes('Home Delivery');
            sorted.sort((a, b) => (offers(a) === offers(b) ? 0 : offers(a) ? -1 : 1) || U.compareNames(a, b));
        }
        return sorted;
    }

    function sortNote(sortBy) {
        if (sortBy === 'delivery') return 'Pharmacies that list home delivery come first, then A to Z.';
        const saved = window.ReliefLocation ? window.ReliefLocation.loadLocation() : null;
        return U.describeSort(sortBy, saved ? { lat: saved.lat, lng: saved.lng } : null).note;
    }

    // Display pharmacies in the UI
    function displayPharmacies(pharmaciesToDisplay) {
        pharmaciesList.innerHTML = '';

        if (pharmaciesToDisplay.length === 0) {
            pharmaciesList.innerHTML = '<p class="no-results">No pharmacies found matching your criteria.</p>';
            setStatus('No pharmacies found.');
            return;
        }

        const sortBy = sortSelect.value;
        const sortedPharmacies = sortPharmacies(pharmaciesToDisplay, sortBy);
        setStatus(pharmaciesToDisplay.length + (pharmaciesToDisplay.length === 1 ? ' pharmacy found. ' : ' pharmacies found. ') + sortNote(sortBy));

        sortedPharmacies.forEach(pharmacy => {
            const pharmacyCard = document.createElement('div');
            pharmacyCard.className = 'pharmacy-card';
            pharmacyCard.innerHTML = `
                <div class="pharmacy-image" style="background-image: url('${pharmacy.image}')"></div>
                <div class="pharmacy-info">
                    <h4 class="pharmacy-name">${pharmacy.name}</h4>
                    <p class="pharmacy-type">${pharmacy.type}</p>
                    <p class="pharmacy-location"><i class="fas fa-map-marker-alt"></i> ${pharmacy.location}</p>
                    ${pharmacy.distanceKm != null ? `<p class="pharmacy-distance">${U.formatDistance(pharmacy.distanceKm)}</p>` : ''}
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
    // Selects filter as soon as they change, like the hospitals page; the Filter button still works too.
    [pharmacyTypeFilter, locationFilter, servicesFilter].forEach(el => el.addEventListener('change', filterPharmacies));
    sortSelect.addEventListener('change', () => {
        filterPharmacies();
    });

    // Initialize with all pharmacies
    displayPharmacies(pharmacies);
    initMap();
    updateMapMarkers(pharmacies);
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
