document.addEventListener('DOMContentLoaded', function() {
    // Mock hospital data
    const hospitals = [
            {
                id: 1,
                name: "All India Institute of Hygiene and Public Health",
                type: "Medical College",
                location: "Kolkata, Established 1932",
                services: ["Public Health", "Hygiene Research", "Medical Education"],
                phone: "+91 33 2241 4239",
                rating: 4.5,
                lat: 22.5726,
                lng: 88.3639,
                image: "../assets/images/aiihph.jpg"
            },
            {
                id: 2,
                name: "All India Institute of Medical Sciences, Kalyani",
                type: "Medical College",
                location: "Kalyani, Established 2019",
                services: ["Super Specialty Care", "Medical Research", "Undergraduate Education"],
                phone: "+91 33 2952 8100",
                rating: 4.8,
                lat: 22.9750,
                lng: 88.4344,
                image: "../assets/images/aiimskalyani.jpg"
            },
            {
                id: 3,
                name: "Bankura Sammilani Medical College and Hospital",
                type: "Medical College",
                location: "Bankura, Established 1956",
                services: ["General Medicine", "Surgery", "Pediatrics"],
                phone: "+91 3242 250 201",
                rating: 4.2,
                lat: 23.2329,
                lng: 87.0755,
                image: "../assets/images/bankuramc.jpg"
            },
            {
                id: 4,
                name: "Barasat Government Medical College and Hospital",
                type: "Medical College",
                location: "Barasat, Established 2022",
                services: ["Emergency Care", "General Surgery", "Obstetrics"],
                phone: "+91 33 2552 1234",
                rating: 4.0,
                lat: 22.7225,
                lng: 88.4886,
                image: "../assets/images/barasatmc.jpg"
            },
            {
                id: 5,
                name: "Burdwan Medical College and Hospital",
                type: "Medical College",
                location: "Purba Bardhaman, Established 1969",
                services: ["Cardiology", "Neurology", "Oncology"],
                phone: "+91 342 255 5401",
                rating: 4.3,
                lat: 23.2599,
                lng: 87.8570,
                image: "../assets/images/burdwanmc.jpg"
            },
            {
                id: 6,
                name: "Calcutta National Medical College",
                type: "Medical College",
                location: "Kolkata, Established 1948",
                services: ["Emergency Care", "Orthopedics", "Neurology"],
                phone: "+91 33 2370 1234",
                rating: 4.4,
                lat: 22.5726,
                lng: 88.3639,
                image: "../assets/images/cnmc.jpg"
            },
            {
                id: 7,
                name: "Calcutta School of Tropical Medicine",
                type: "Medical College",
                location: "Kolkata, Established 1914",
                services: ["Tropical Diseases", "Research", "Postgraduate Training"],
                phone: "+91 33 2241 3441",
                rating: 4.6,
                lat: 22.5587,
                lng: 88.3509,
                image: "../assets/images/tropicalmed.jpg"
            },
            {
                id: 8,
                name: "Chittaranjan National Cancer Institute",
                type: "Medical College",
                location: "Kolkata, Established 1950",
                services: ["Oncology", "Cancer Research", "Radiotherapy"],
                phone: "+91 33 2476 5101",
                rating: 4.7,
                lat: 22.5730,
                lng: 88.3632,
                image: "../assets/images/cnci.jpg"
            },
            {
                id: 9,
                name: "College of Medicine and JNM Hospital",
                type: "Medical College",
                location: "Kalyani, Established 2009",
                services: ["General Medicine", "Pediatrics", "Surgery"],
                phone: "+91 33 2582 1234",
                rating: 4.1,
                lat: 22.9750,
                lng: 88.4344,
                image: "../assets/images/jnmhospital.jpg"
            },
            {
                id: 10,
                name: "College of Medicine & Sagore Dutta Hospital",
                type: "Medical College",
                location: "Kamarhati, Established 2010",
                services: ["Emergency Care", "General Surgery", "Obstetrics"],
                phone: "+91 33 2563 1234",
                rating: 4.0,
                lat: 22.6711,
                lng: 88.3744,
                image: "../assets/images/sagoredutta.jpg"
            },
            {
                id: 11,
                name: "Deben Mahata Government Medical College and Hospital",
                type: "Medical College",
                location: "Purulia, Established 2020",
                services: ["General Medicine", "Pediatrics", "Emergency Care"],
                phone: "+91 3252 250 123",
                rating: 3.9,
                lat: 23.3338,
                lng: 86.3648,
                image: "../assets/images/debenmahata.jpg"
            },
            {
                id: 12,
                name: "Diamond Harbour Government Medical College and Hospital",
                type: "Medical College",
                location: "Diamond Harbour, Established 2019",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 3174 250 123",
                rating: 4.0,
                lat: 22.1910,
                lng: 88.1909,
                image: "../assets/images/diamondharbourmc.jpg"
            },
            {
                id: 13,
                name: "Dr B C Roy Institute of Medical Sciences and Research",
                type: "Medical College",
                location: "Kharagpur, Established 2018",
                services: ["Medical Research", "Undergraduate Education", "Pediatrics"],
                phone: "+91 3222 255 123",
                rating: 4.2,
                lat: 22.3460,
                lng: 87.2320,
                image: "../assets/images/bcroymc.jpg"
            },
            {
                id: 14,
                name: "Dr. B C Roy Post Graduate Institute of Paediatric Sciences",
                type: "Medical College",
                location: "Kolkata, Established 2010",
                services: ["Pediatrics", "Neonatology", "Child Health Research"],
                phone: "+91 33 2456 7890",
                rating: 4.5,
                lat: 22.5735,
                lng: 88.3628,
                image: "../assets/images/bcroy_pediatric.jpg"
            },
            {
                id: 15,
                name: "East West Institute of Medical Sciences and Research",
                type: "Medical College",
                location: "Burdwan, Established 2024",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 342 250 1234",
                rating: 3.8,
                lat: 23.2599,
                lng: 87.8570,
                image: "../assets/images/eastwestmc.jpg"
            },
            {
                id: 16,
                name: "ESIC Medical College",
                type: "Medical College",
                location: "Joka, Established 2013",
                services: ["Employee Health Services", "General Medicine", "Surgery"],
                phone: "+91 33 2467 1234",
                rating: 4.0,
                lat: 22.4485,
                lng: 88.3045,
                image: "../assets/images/esicmc.jpg"
            },
            {
                id: 17,
                name: "Gouri Devi Institute of Medical Sciences and Hospital",
                type: "Medical College",
                location: "Durgapur, Established 2016",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 343 250 1234",
                rating: 3.9,
                lat: 23.5204,
                lng: 87.3119,
                image: "../assets/images/gouridevimc.jpg"
            },
            {
                id: 18,
                name: "ICARE Institute of Medical Sciences and Research",
                type: "Medical College",
                location: "Haldia, Established 2011",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 3224 250 123",
                rating: 4.0,
                lat: 22.0257,
                lng: 88.0583,
                image: "../assets/images/icaremc.jpg"
            },
            {
                id: 19,
                name: "Institute of Child Health",
                type: "Medical College",
                location: "Kolkata, Established 1953",
                services: ["Pediatrics", "Neonatology", "Child Nutrition"],
                phone: "+91 33 2241 1234",
                rating: 4.6,
                lat: 22.5735,
                lng: 88.3628,
                image: "../assets/images/childhealth.jpg"
            },
            {
                id: 20,
                name: "IPGMER and SSKM Hospital",
                type: "Medical College",
                location: "Kolkata, Established 1957",
                services: ["Super Specialty Care", "Postgraduate Education", "Research"],
                phone: "+91 33 2204 1234",
                rating: 4.7,
                lat: 22.5356,
                lng: 88.3494,
                image: "../assets/images/sskm.jpg"
            },
            {
                id: 21,
                name: "IQ City Medical College",
                type: "Medical College",
                location: "Durgapur, Established 2013",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 343 250 5678",
                rating: 4.1,
                lat: 23.5204,
                lng: 87.3119,
                image: "../assets/images/iqcitymc.jpg"
            },
            {
                id: 22,
                name: "Jagannath Gupta Institute of Medical Sciences and Hospital",
                type: "Medical College",
                location: "Budge Budge, Established 2016",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 33 2490 1234",
                rating: 3.8,
                lat: 22.4700,
                lng: 88.1700,
                image: "../assets/images/jagannathguptamc.jpg"
            },
            {
                id: 23,
                name: "Jakir Hossain Medical College and Research Institute",
                type: "Medical College",
                location: "Jangipur, Established 2024",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 3483 250 123",
                rating: 3.7,
                lat: 24.4700,
                lng: 88.0700,
                image: "../assets/images/jakirhossainmc.jpg"
            },
            {
                id: 24,
                name: "Jalpaiguri Government Medical College and Hospital",
                type: "Medical College",
                location: "Jalpaiguri, Established 2022",
                services: ["General Medicine", "Surgery", "Pediatrics"],
                phone: "+91 3561 250 123",
                rating: 4.0,
                lat: 26.5167,
                lng: 88.7333,
                image: "../assets/images/jalpaigurimc.jpg"
            },
            {
                id: 25,
                name: "Jhargram Government Medical College and Hospital",
                type: "Medical College",
                location: "Jhargram, Established 2021",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 3221 250 123",
                rating: 3.9,
                lat: 22.4500,
                lng: 86.9800,
                image: "../assets/images/jhargrammc.jpg"
            },
            {
                id: 26,
                name: "JIS School of Medical Science & Research",
                type: "Medical College",
                location: "Howrah, Established 2023",
                services: ["General Medicine", "Surgery", "Research"],
                phone: "+91 33 2637 1234",
                rating: 3.8,
                lat: 22.5958,
                lng: 88.2636,
                image: "../assets/images/jismc.jpg"
            },
            {
                id: 27,
                name: "JMN Medical College and Hospital",
                type: "Medical College",
                location: "Chakdaha, Established 2023",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 33 2550 1234",
                rating: 3.7,
                lat: 23.0800,
                lng: 88.5200,
                image: "../assets/images/jmnmc.jpg"
            },
            {
                id: 28,
                name: "Krishnanagar Institute of Medical Science",
                type: "Medical College",
                location: "Krishnanagar, Established 2024",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 3472 250 123",
                rating: 3.8,
                lat: 23.4000,
                lng: 88.5000,
                image: "../assets/images/krishnanagarmc.jpg"
            },
            {
                id: 29,
                name: "KPC Medical College and Hospital",
                type: "Medical College",
                location: "Kolkata, Established 2006",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 33 2441 1234",
                rating: 4.0,
                lat: 22.5726,
                lng: 88.3639,
                image: "../assets/images/kpcmc.jpg"
            },
            {
                id: 30,
                name: "Maharaja Jitendra Narayan Medical College and Hospital",
                type: "Medical College",
                location: "Cooch Behar, Established 2018",
                services: ["General Medicine", "Surgery", "Pediatrics"],
                phone: "+91 3582 250 123",
                rating: 4.0,
                lat: 26.3167,
                lng: 89.4333,
                image: "../assets/images/coochbeharmc.jpg"
            },
            {
                id: 31,
                name: "Malda Medical College and Hospital",
                type: "Medical College",
                location: "Malda, Established 2011",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 3512 250 123",
                rating: 4.1,
                lat: 25.0000,
                lng: 88.1500,
                image: "../assets/images/maldamc.jpg"
            },
            {
                id: 32,
                name: "Medical College and Hospital, Kolkata",
                type: "Medical College",
                location: "Kolkata, Established 1835",
                services: ["All Specialties", "Oldest Medical College", "Research"],
                phone: "+91 33 2204 1101",
                rating: 4.8,
                lat: 22.5738,
                lng: 88.3611,
                image: "../assets/images/mchkolkata.jpg"
            },
            {
                id: 33,
                name: "Midnapore Medical College and Hospital",
                type: "Medical College",
                location: "Midnapore, Established 2004",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 3222 250 123",
                rating: 4.2,
                lat: 22.4250,
                lng: 87.3200,
                image: "../assets/images/midnaporemc.jpg"
            },
            {
                id: 34,
                name: "Murshidabad Medical College and Hospital",
                type: "Medical College",
                location: "Berhampore, Established 2012",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 3482 250 123",
                rating: 4.0,
                lat: 24.1000,
                lng: 88.2500,
                image: "../assets/images/murshidabadmc.jpg"
            },
            {
                id: 35,
                name: "Nil Ratan Sircar Medical College and Hospital",
                type: "Medical College",
                location: "Kolkata, Established 1873",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 33 2223 5181",
                rating: 4.5,
                lat: 22.5745,
                lng: 88.3622,
                image: "../assets/images/nrsmc.jpg"
            },
            {
                id: 36,
                name: "North Bengal Medical College and Hospital",
                type: "Medical College",
                location: "Siliguri, Established 1968",
                services: ["Emergency Care", "Pediatrics", "General Medicine"],
                phone: "+91 353 250 1234",
                rating: 4.3,
                lat: 26.7271,
                lng: 88.3953,
                image: "../assets/images/nbmc.jpg"
            },
            {
                id: 37,
                name: "Prafulla Chandra Sen Government Medical College and Hospital",
                type: "Medical College",
                location: "Arambagh, Established 2022",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 3212 250 123",
                rating: 3.9,
                lat: 22.8800,
                lng: 87.7800,
                image: "../assets/images/arambaghmc.jpg"
            },
            {
                id: 38,
                name: "PKG Medical College and Hospital",
                type: "Medical College",
                location: "New Town, Established 2024",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 33 2567 1234",
                rating: 3.8,
                lat: 22.5800,
                lng: 88.4500,
                image: "../assets/images/pkgmc.jpg"
            },
            {
                id: 39,
                name: "R. G. Kar Medical College and Hospital",
                type: "Medical College",
                location: "Kolkata, Established 1886",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 33 2555 1234",
                rating: 4.4,
                lat: 22.5950,
                lng: 88.3700,
                image: "../assets/images/rgkar.jpg"
            },
            {
                id: 40,
                name: "Raiganj Government Medical College and Hospital",
                type: "Medical College",
                location: "Raiganj, Established 2018",
                services: ["General Medicine", "Surgery", "Pediatrics"],
                phone: "+91 3523 250 123",
                rating: 4.0,
                lat: 25.6200,
                lng: 88.1200,
                image: "../assets/images/raiganjmc.jpg"
            },
            {
                id: 41,
                name: "Rampurhat Government Medical College and Hospital",
                type: "Medical College",
                location: "Rampurhat, Established 2018",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 3461 250 123",
                rating: 3.9,
                lat: 24.1700,
                lng: 87.7800,
                image: "../assets/images/rampurhatmc.jpg"
            },
            {
                id: 42,
                name: "Santiniketan Medical College",
                type: "Medical College",
                location: "Bolpur, Established 2021",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 3463 250 123",
                rating: 3.8,
                lat: 23.6700,
                lng: 87.7200,
                image: "../assets/images/santiniketanmc.jpg"
            },
            {
                id: 43,
                name: "Sarat Chandra Chattopadhyay Government Medical College and Hospital",
                type: "Medical College",
                location: "Uluberia, Established 2022",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 33 2661 1234",
                rating: 3.9,
                lat: 22.4700,
                lng: 88.1100,
                image: "../assets/images/uluberiamc.jpg"
            },
            {
                id: 44,
                name: "Shri Ramkrishna Institute of Medical Sciences and Sanaka Hospital",
                type: "Medical College",
                location: "Durgapur, Established 2019",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 343 250 5678",
                rating: 4.0,
                lat: 23.5204,
                lng: 87.3119,
                image: "../assets/images/srimc.jpg"
            },
            {
                id: 45,
                name: "Tamralipto Government Medical College and Hospital",
                type: "Medical College",
                location: "Tamluk, Established 2022",
                services: ["General Medicine", "Surgery", "Obstetrics"],
                phone: "+91 3228 250 123",
                rating: 3.9,
                lat: 22.3000,
                lng: 87.9200,
                image: "../assets/images/tamraliptomc.jpg"
            },
            {
                id: 46,
                name: "Vivekananda Institute of Medical Sciences",
                type: "Medical College",
                location: "Kolkata, Established 1963",
                services: ["General Medicine", "Surgery", "Emergency Care"],
                phone: "+91 33 2456 1234",
                rating: 4.2,
                lat: 22.5726,
                lng: 88.3639,
                image: "../assets/images/vivekanandamc.jpg"
            }
        ];

    // DOM elements
    const hospitalsList = document.querySelector('.hospitals-list');
    const searchInput = document.querySelector('.search-box input');
    const facilityTypeFilter = document.getElementById('facility-type');
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
        let center;
        
        if (userLocation && Array.isArray(userLocation)) {
            center = userLocation;
        } else {
            center = [40.7128, -74.0060]; // Default to New York
        }
        
        map = L.map('map').setView(center, 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add marker for user's location if available
        if (userLocation && Array.isArray(userLocation)) {
            L.marker(userLocation)
                .addTo(map)
                .bindPopup('Your Location')
                .openPopup();
        }
    }

    function updateMapMarkers(hospitalsToShow) {
        // Clear existing markers
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];

        // Add new markers
        hospitalsToShow.forEach(hospital => {
            const marker = L.marker([hospital.lat, hospital.lng])
                .addTo(map)
                .bindPopup(`<b>${hospital.name}</b><br>${hospital.location}`);
            
            markers.push(marker);
        });

        // Adjust map view to show all markers if there are any
        if (hospitalsToShow.length > 0) {
            const markerGroup = new L.featureGroup(markers);
            map.fitBounds(markerGroup.getBounds().pad(0.2));
        } else if (map) {
            // Reset to default view if no markers
            const userLocation = JSON.parse(localStorage.getItem('userLocation'));
            const center = userLocation && Array.isArray(userLocation) ? userLocation : [40.7128, -74.0060];
            map.setView(center, 13);
        }
    }

    // Display all hospitals initially
    function displayHospitals(hospitalsToDisplay) {
        hospitalsList.innerHTML = '';

        if (hospitalsToDisplay.length === 0) {
            hospitalsList.innerHTML = '<p class="no-results">No hospitals found matching your criteria.</p>';
            updateMapMarkers([]);
            return;
        }

        const sortBy = sortSelect.value;
        const sortedHospitals = sortHospitals(hospitalsToDisplay, sortBy);

        sortedHospitals.forEach(hospital => {
            const hospitalCard = document.createElement('div');
            hospitalCard.className = 'hospital-card';
            hospitalCard.innerHTML = `
                <div class="hospital-image" style="background-image: url('${hospital.image}')"></div>
                <div class="hospital-info">
                    <h4 class="hospital-name">${hospital.name}</h4>
                    <p class="hospital-type">${hospital.type}</p>
                    <p class="hospital-location"><i class="fas fa-map-marker-alt"></i> ${hospital.location}</p>
                    <div class="hospital-services">
                        ${hospital.services.map(service => 
                            `<span class="service-tag">${service}</span>`
                        ).join('')}
                    </div>
                    <div class="hospital-actions">
                        <button class="btn-directions" data-lat="${hospital.lat}" data-lng="${hospital.lng}">
                            <i class="fas fa-directions"></i> Directions
                        </button>
                        <button class="btn-call" data-phone="${hospital.phone}">
                            <i class="fas fa-phone"></i> Call
                        </button>
                    </div>
                </div>
            `;
            hospitalsList.appendChild(hospitalCard);
        });

        // Add event listeners to buttons
        document.querySelectorAll('.btn-directions').forEach(button => {
            button.addEventListener('click', function() {
                const lat = parseFloat(this.getAttribute('data-lat'));
                const lng = parseFloat(this.getAttribute('data-lng'));
                // Open directions in new tab
                window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
            });
        });

        document.querySelectorAll('.btn-call').forEach(button => {
            button.addEventListener('click', function() {
                const phone = this.getAttribute('data-phone');
                // Initiate phone call
                window.location.href = `tel:${phone}`;
            });
        });

        updateMapMarkers(sortedHospitals);
    }

    // Filter hospitals based on search and filters
    function filterHospitals() {
        const searchTerm = searchInput.value.toLowerCase();
        const facilityType = facilityTypeFilter.value;
        const location = locationFilter.value;
        const services = servicesFilter.value;

        const filteredHospitals = hospitals.filter(hospital => {
            const matchesSearch = 
                hospital.name.toLowerCase().includes(searchTerm) ||
                hospital.location.toLowerCase().includes(searchTerm);
            
            const matchesFacilityType = !facilityType || 
                hospital.type.toLowerCase() === facilityType.toLowerCase().replace('-', ' ');
            const matchesLocation = !location || 
                hospital.location.toLowerCase().includes(location.toLowerCase());
            const matchesServices = !services || 
                hospital.services.some(s => 
                    s.toLowerCase().includes(services.toLowerCase().replace('-', ' '))
                );

            return matchesSearch && matchesFacilityType && matchesLocation && matchesServices;
        });

        displayHospitals(filteredHospitals);
    }

    // Sort hospitals
    function sortHospitals(hospitalsList, sortBy) {
        return [...hospitalsList].sort((a, b) => {
            if (sortBy === 'rating') {
                return b.rating - a.rating;
            } else {
                // Sort by distance (extract distance from location string)
                const extractDistance = (location) => {
                    const match = location.match(/(\d+\.?\d*) miles away/);
                    return match ? parseFloat(match[1]) : Infinity;
                };
                return extractDistance(a.location) - extractDistance(b.location);
            }
        });
    }

    // Event listeners
    searchInput.addEventListener('input', filterHospitals);
    filterButton.addEventListener('click', filterHospitals);
    sortSelect.addEventListener('change', filterHospitals);

    // Initialize
    initMap();
    displayHospitals(hospitals);

    // API search function (kept for reference)
    async function searchHospitals(lat, lng, radius = 10) {
        try {
            // Try CMS API first
            const cmsResponse = await fetch(`https://data.cms.gov/data-api/v1/dataset/9c7c7e7a-3f3e-4f3b-9c3e-3f3e3f3e3f3e/data?latitude=${lat}&longitude=${lng}&radius=${radius}`);
            
            if (!cmsResponse.ok) throw new Error('CMS API failed');
            
            const cmsData = await cmsResponse.json();
            
            if (cmsData && cmsData.length > 0) {
                return cmsData.map(hospital => ({
                    id: hospital.id,
                    name: hospital.name,
                    type: 'Hospital',
                    location: hospital.address,
                    services: hospital.services?.split(',') || [],
                    phone: hospital.phone,
                    rating: hospital.rating,
                    lat: hospital.latitude,
                    lng: hospital.longitude,
                    image: "../assets/images/hospital-default.jpg"
                }));
            }
            
            // Fallback to OpenStreetMap if CMS fails
            const osmResponse = await fetch(`https://overpass-api.de/api/interpreter?data=[out:json];node[amenity=hospital](around:${radius*1000},${lat},${lng});out;`);
            
            if (!osmResponse.ok) throw new Error('OSM API failed');
            
            const osmData = await osmResponse.json();
            
            return osmData.elements.map(hospital => ({
                id: hospital.id,
                name: hospital.tags?.name || 'Hospital',
                type: 'Hospital',
                location: hospital.tags?.['addr:full'] || 'Location not available',
                services: [],
                phone: hospital.tags?.phone || '',
                rating: null,
                lat: hospital.lat,
                lng: hospital.lon,
                image: "../assets/images/hospital-default.jpg"
            }));
        } catch (error) {
            console.error('Error fetching hospitals:', error);
            return [];
        }
    }
});