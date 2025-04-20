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

    function initMap() {
        // Use user's location if available, or default to a central location
        const userLocation = JSON.parse(localStorage.getItem('userLocation'));
        const center = userLocation ? [userLocation.lat, userLocation.lng] : [24.417, 86.473]; // Default to New York
        
        map = L.map('map').setView(center, 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add marker for user's location if available
        if (userLocation) {
            const userIcon = L.icon({
                iconUrl: '../assets/images/user-marker.png',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            });
            
            L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
                .addTo(map)
                .bindPopup('Your Location')
                .openPopup();
        }
        
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