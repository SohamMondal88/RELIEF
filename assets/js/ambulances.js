document.addEventListener('DOMContentLoaded', function() {
    // Mock ambulance services data
    const ambulanceServices = [
        {
            id: 1,
            name: "City Emergency Medical Services",
            type: "Emergency",
            location: "123 Main St, Downtown, 1.5 miles away",
            phone: "+1 555 911 0000",
            responseTime: "5-10 minutes",
            lat: 40.7128,
            lng: -74.0060
        },
        {
            id: 2,
            name: "Metro Ambulance Service",
            type: "Emergency & Non-Emergency",
            location: "456 Oak Ave, Westside, 2.8 miles away",
            phone: "+1 555 922 1111",
            responseTime: "10-15 minutes",
            lat: 40.7328,
            lng: -74.0260
        },
        {
            id: 3,
            name: "Regional Medical Transport",
            type: "Non-Emergency",
            location: "789 Pine Rd, Northside, 3.2 miles away",
            phone: "+1 555 933 2222",
            responseTime: "30-45 minutes",
            lat: 40.7528,
            lng: -74.0160
        },
        {
            id: 4,
            name: "Community Ambulance Network",
            type: "Emergency",
            location: "321 Elm Blvd, Eastside, 4.5 miles away",
            phone: "+1 555 944 3333",
            responseTime: "15-20 minutes",
            lat: 40.7028,
            lng: -73.9960
        }
    ];

    // DOM elements
    const ambulanceList = document.querySelector('.ambulance-list');
    const call911Button = document.querySelector('.btn-call-911');
    const requestButton = document.querySelector('.btn-request');

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
            const userIcon = L.icon({
                iconUrl: '../assets/images/user-marker.png',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            });
            userMarker = L.marker(location, { icon: userIcon }).addTo(map).bindPopup('Your Location');
        }
    }

    document.addEventListener('relief:location-changed', function() {
        if (!map) return;
        const location = getUserLocation();
        setUserMarker(location);
        if (location) map.setView(location, 13);
    });

    // The map library comes from a CDN. When it did not load (offline, blocked, slow) the rest of the page
    // still works, so say that the map is missing instead of leaving an empty box.
    function showMapUnavailable(mapElement) {
        mapElement.hidden = true;
        const note = document.createElement('p');
        note.className = 'map-unavailable';
        note.setAttribute('role', 'status');
        note.textContent = 'The map could not be loaded, so it is not shown. The ambulance list above still works, and Directions opens the route in your maps app.';
        mapElement.parentNode.insertBefore(note, mapElement);
    }

    function initMap() {
        const mapElement = document.getElementById('map');
        if (!mapElement) return;
        if (typeof L === 'undefined') {
            showMapUnavailable(mapElement);
            return;
        }

        // Use the saved location if there is one, otherwise a West Bengal overview
        const userLocation = getUserLocation();
        const center = userLocation || DEFAULT_CENTER;

        map = L.map('map').setView(center, userLocation ? 13 : 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add marker for user's location if available
        setUserMarker(userLocation);

        // Add ambulance markers
        updateMapMarkers(ambulanceServices);
    }

    function updateMapMarkers(ambulancesToShow) {
        // Clear existing markers
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];

        // Add new markers with ambulance icons
        ambulancesToShow.forEach(ambulance => {
            const ambulanceIcon = L.icon({
                iconUrl: '../assets/images/ambulance-marker.png',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            });

            const marker = L.marker([ambulance.lat, ambulance.lng], { icon: ambulanceIcon })
                .addTo(map)
                .bindPopup(`<b>${ambulance.name}</b><br>${ambulance.location}<br>Phone: ${ambulance.phone}`);

            markers.push(marker);
        });

        // Adjust map view to show all markers if there are any
        if (ambulancesToShow.length > 0) {
            const markerGroup = L.featureGroup(markers);
            map.fitBounds(markerGroup.getBounds().pad(0.2));
        }
    }

    // Display ambulance services
    function displayAmbulanceServices() {
        ambulanceList.innerHTML = '';

        ambulanceServices.forEach(ambulance => {
            const ambulanceItem = document.createElement('div');
            ambulanceItem.className = 'ambulance-item';
            ambulanceItem.innerHTML = `
                <div class="ambulance-info">
                    <h4>${ambulance.name}</h4>
                    <p><i class="fas fa-map-marker-alt"></i> ${ambulance.location}</p>
                    <p><i class="fas fa-phone"></i> ${ambulance.phone}</p>
                    <p><i class="fas fa-clock"></i> Avg. response time: ${ambulance.responseTime}</p>
                </div>
                <div class="ambulance-actions">
                    <button class="btn-call" data-phone="${ambulance.phone}">
                        <i class="fas fa-phone"></i> Call
                    </button>
                    <button class="btn-directions" data-lat="${ambulance.lat}" data-lng="${ambulance.lng}">
                        <i class="fas fa-directions"></i> Directions
                    </button>
                </div>
            `;
            ambulanceList.appendChild(ambulanceItem);
        });

        // Add event listeners to call buttons
        document.querySelectorAll('.btn-call').forEach(button => {
            button.addEventListener('click', function() {
                const phone = this.getAttribute('data-phone');
                window.open(`tel:${phone}`);
            });
        });

        // Add event listeners to directions buttons
        document.querySelectorAll('.btn-directions').forEach(button => {
            button.addEventListener('click', function() {
                const lat = this.getAttribute('data-lat');
                const lng = this.getAttribute('data-lng');
                window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
            });
        });
    }

    // Emergency call button
    call911Button.addEventListener('click', function() {
        window.open('tel:911');
    });

    // Request non-emergency transport
    requestButton.addEventListener('click', function() {
        // In a real app, this would open a request form
        alert('Opening non-emergency medical transport request form');
    });

    // Initialize the page
    displayAmbulanceServices();
    initMap();
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
