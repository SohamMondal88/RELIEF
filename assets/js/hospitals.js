document.addEventListener('DOMContentLoaded', function() {
    const U = window.FacilityUtils;
    const DATA_URL = '../assets/data/facilities.json';
    const DEFAULT_CENTER = [22.9868, 87.8550]; // West Bengal

    const hospitalsList = document.querySelector('.hospitals-list');
    const searchInput = document.querySelector('.search-box input');
    const searchForm = document.querySelector('.search-box');
    const facilityTypeFilter = document.getElementById('facility-type');
    const districtFilter = document.getElementById('location');
    const servicesFilter = document.getElementById('services');
    const verifiedOnly = document.getElementById('verified-only');
    const filterButton = document.querySelector('.btn-filter');
    const sortSelect = document.querySelector('.sort-options select');
    const statusEl = document.getElementById('directory-status');
    const locateButton = document.getElementById('use-my-location');

    if (!hospitalsList || !U) return;

    let facilities = [];
    let map = null;
    let markers = [];

    function readSavedLocation() {
        try {
            return U.parseUserLocation(localStorage.getItem('userLocation'));
        } catch (e) {
            return null;
        }
    }

    function setStatus(message) {
        if (statusEl) statusEl.textContent = message;
    }

    function initMap() {
        if (typeof L === 'undefined' || !document.getElementById('map')) return;
        const saved = readSavedLocation();
        const center = saved ? [saved.lat, saved.lng] : DEFAULT_CENTER;
        map = L.map('map').setView(center, saved ? 11 : 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        if (saved) {
            L.marker(center).addTo(map).bindPopup('Your Location');
        }
    }

    function updateMapMarkers(list) {
        if (!map) return;
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
        list.forEach(f => {
            if (!U.isValidCoord(f.lat, f.lng)) return;
            const marker = L.marker([f.lat, f.lng])
                .addTo(map)
                .bindPopup('<b>' + U.escapeHtml(f.name) + '</b><br>' + U.escapeHtml(f.district));
            markers.push(marker);
        });
        if (markers.length > 0) {
            map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
        }
    }

    function fillSelect(select, firstLabel, values, labelFor) {
        if (!select) return;
        select.innerHTML = '';
        const first = document.createElement('option');
        first.value = '';
        first.textContent = firstLabel;
        select.appendChild(first);
        values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = labelFor ? labelFor(v) : v;
            select.appendChild(opt);
        });
    }

    function populateFilters() {
        const options = U.getFilterOptions(facilities);
        fillSelect(facilityTypeFilter, 'All Facilities', options.types, t => U.FACILITY_TYPES[t] || t);
        fillSelect(districtFilter, 'All Areas', options.districts);
        fillSelect(servicesFilter, 'All Services', options.services);
    }

    function cardHtml(f) {
        const notAvailable = '<span class="not-available">Not available</span>';
        const phoneHref = f.phone ? String(f.phone).replace(/[^\d+]/g, '') : '';
        const hasCoords = U.isValidCoord(f.lat, f.lng);
        const services = f.services.length
            ? f.services.map(s => '<span class="service-tag">' + U.escapeHtml(s) + '</span>').join('')
            : notAvailable;
        const distance = f.distanceKm != null
            ? '<p class="hospital-distance">' + U.escapeHtml(U.formatDistance(f.distanceKm)) + '</p>'
            : '';
        const badgeClass = f.verified ? 'badge-verified' : 'badge-unverified';
        const badgeText = f.verified ? 'Verified' : 'Not verified';
        const detail = f.verified ? U.verificationLabel(f).replace(/^Verified - /, '') : 'no source recorded yet';
        return '' +
            '<div class="hospital-info">' +
                '<h4 class="hospital-name">' + U.escapeHtml(f.name) + '</h4>' +
                '<p class="hospital-type">' + U.escapeHtml(U.FACILITY_TYPES[f.type] || f.type || 'Not available') + '</p>' +
                '<p><span class="verify-badge ' + badgeClass + '">' + badgeText + '</span> ' +
                    '<span class="verify-detail">' + U.escapeHtml(detail) + '</span></p>' +
                '<p class="hospital-location"><i class="fas fa-map-marker-alt" aria-hidden="true"></i> ' +
                    (f.district ? U.escapeHtml(f.district) : notAvailable) + '</p>' +
                distance +
                '<p class="hospital-detail"><strong>Address:</strong> ' + (f.address ? U.escapeHtml(f.address) : notAvailable) + '</p>' +
                '<p class="hospital-detail"><strong>Phone:</strong> ' + (f.phone ? U.escapeHtml(f.phone) : notAvailable) + '</p>' +
                '<p class="hospital-detail"><strong>Hours:</strong> ' + (f.hours ? U.escapeHtml(f.hours) : notAvailable) + '</p>' +
                '<div class="hospital-services">' + services + '</div>' +
                '<div class="hospital-actions">' +
                    (hasCoords
                        ? '<button type="button" class="btn-directions" data-lat="' + f.lat + '" data-lng="' + f.lng + '" aria-label="Directions to ' + U.escapeHtml(f.name) + '"><i class="fas fa-directions" aria-hidden="true"></i> Directions</button>'
                        : '') +
                    (phoneHref
                        ? '<a class="btn-call" href="tel:' + U.escapeHtml(phoneHref) + '" aria-label="Call ' + U.escapeHtml(f.name) + '"><i class="fas fa-phone" aria-hidden="true"></i> Call</a>'
                        : '') +
                '</div>' +
            '</div>';
    }

    function render(list, note) {
        hospitalsList.innerHTML = '';
        if (list.length === 0) {
            const p = document.createElement('p');
            p.className = 'no-results';
            p.textContent = 'No facilities found matching your criteria. Try clearing a filter or searching for something else.';
            hospitalsList.appendChild(p);
            setStatus('No facilities found.');
            updateMapMarkers([]);
            return;
        }
        list.forEach(f => {
            const card = document.createElement('div');
            card.className = 'hospital-card';
            card.innerHTML = cardHtml(f);
            hospitalsList.appendChild(card);
        });
        const count = list.length + (list.length === 1 ? ' facility found.' : ' facilities found.');
        setStatus(note ? count + ' ' + note : count);
        updateMapMarkers(list);
    }

    function applyFilters() {
        const filtered = U.filterFacilities(facilities, {
            search: searchInput ? searchInput.value : '',
            type: facilityTypeFilter ? facilityTypeFilter.value : '',
            district: districtFilter ? districtFilter.value : '',
            service: servicesFilter ? servicesFilter.value : '',
            verifiedOnly: verifiedOnly ? verifiedOnly.checked : false
        });
        const sortBy = sortSelect ? sortSelect.value : 'name';
        const location = readSavedLocation();
        const sorted = U.sortFacilities(filtered, sortBy, location);
        const note = (sortBy === 'distance' && !location)
            ? 'Distance sorting needs your location, so the list is sorted A to Z. Use the "Use my location" button.'
            : '';
        render(sorted, note);
    }

    function locateUser() {
        if (!navigator.geolocation) {
            setStatus('Location is not supported by this browser. Sorting by name instead.');
            return;
        }
        setStatus('Finding your location...');
        navigator.geolocation.getCurrentPosition(function(pos) {
            try {
                localStorage.setItem('userLocation', JSON.stringify({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                }));
            } catch (e) { /* storage unavailable; the location is used only for this visit */ }
            if (sortSelect) sortSelect.value = 'distance';
            applyFilters();
        }, function(err) {
            const reasons = {
                1: 'Location permission was denied.',
                2: 'Your position is unavailable.',
                3: 'Finding your location took too long.'
            };
            setStatus((reasons[err && err.code] || 'Could not get your location.') + ' Showing facilities sorted by name.');
        }, { timeout: 10000, maximumAge: 300000 });
    }

    function showLoading() {
        hospitalsList.innerHTML = '<p class="loading-state">Loading facilities...</p>';
        setStatus('Loading facilities...');
    }

    function showError() {
        hospitalsList.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'error-state';
        wrap.setAttribute('role', 'alert');
        wrap.innerHTML = '<p>The facility list could not be loaded. Check your connection and try again.</p>';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn-filter';
        retry.textContent = 'Retry';
        retry.addEventListener('click', loadFacilities);
        wrap.appendChild(retry);
        hospitalsList.appendChild(wrap);
        setStatus('The facility list could not be loaded.');
    }

    function loadFacilities() {
        showLoading();
        fetch(DATA_URL)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                facilities = U.normalizeFacilities(data);
                populateFilters();
                applyFilters();
            })
            .catch(() => showError());
    }

    hospitalsList.addEventListener('click', function(e) {
        const btn = e.target.closest('.btn-directions');
        if (!btn) return;
        const lat = parseFloat(btn.getAttribute('data-lat'));
        const lng = parseFloat(btn.getAttribute('data-lng'));
        if (U.isValidCoord(lat, lng)) {
            window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng, '_blank', 'noopener');
        }
    });

    if (searchForm) searchForm.addEventListener('submit', e => { e.preventDefault(); applyFilters(); });
    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (filterButton) filterButton.addEventListener('click', applyFilters);
    [facilityTypeFilter, districtFilter, servicesFilter, verifiedOnly, sortSelect].forEach(el => {
        if (el) el.addEventListener('change', applyFilters);
    });
    if (locateButton) locateButton.addEventListener('click', locateUser);

    initMap();
    loadFacilities();
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
