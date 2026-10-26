document.addEventListener('DOMContentLoaded', function() {
    const U = window.FacilityUtils;
    const DATA_URL = '../assets/data/facilities.json';
    const DEFAULT_CENTER = [22.9868, 87.8550]; // West Bengal, used when no location is saved

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
    let userMarker = null;

    // Saved facilities live in localStorage so they work offline
    const SAVED_KEY = 'relief_saved_facilities';
    const savedList = document.getElementById('saved-facilities-list');

    function getSavedFacilities() {
        try {
            const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function setSavedFacilities(items) {
        try {
            localStorage.setItem(SAVED_KEY, JSON.stringify(items));
        } catch (error) {
            console.error('Could not save facility:', error);
        }
    }

    function renderSavedFacilities() {
        if (!savedList) return;
        const items = getSavedFacilities();
        savedList.textContent = '';

        if (items.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'saved-empty';
            empty.textContent = 'No saved facilities yet. Use Save on a hospital below.';
            savedList.appendChild(empty);
            return;
        }

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'saved-item';

            const name = document.createElement('strong');
            name.textContent = item.name;
            const location = document.createElement('div');
            location.textContent = item.location;
            const meta = document.createElement('div');
            meta.className = 'saved-meta';
            meta.textContent = 'Saved copy, added ' + new Date(item.savedAt).toLocaleDateString();

            row.appendChild(name);
            row.appendChild(location);
            row.appendChild(meta);

            if (item.phone) {
                const call = document.createElement('a');
                call.href = 'tel:' + item.phone;
                call.textContent = 'Call ' + item.phone;
                row.appendChild(call);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-save is-saved';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => toggleSaved(String(item.id)));
            row.appendChild(remove);

            savedList.appendChild(row);
        });
    }

    function toggleSaved(id) {
        const items = getSavedFacilities();
        const exists = items.some(item => String(item.id) === id);
        if (exists) {
            setSavedFacilities(items.filter(item => String(item.id) !== id));
        } else {
            const facility = facilities.find(f => f.id === id);
            if (!facility) return;
            items.push({
                id: facility.id,
                name: facility.name,
                location: facility.address || facility.district || '',
                phone: facility.phone,
                lat: facility.lat,
                lng: facility.lng,
                savedAt: Date.now()
            });
            setSavedFacilities(items);
        }
        renderSavedFacilities();
        updateSaveButtons();
    }

    function updateSaveButtons() {
        const savedIds = new Set(getSavedFacilities().map(item => String(item.id)));
        document.querySelectorAll('.hospitals-list .btn-save').forEach(button => {
            const saved = savedIds.has(button.getAttribute('data-id'));
            button.classList.toggle('is-saved', saved);
            button.textContent = saved ? 'Saved' : 'Save';
            button.setAttribute('aria-pressed', saved ? 'true' : 'false');
        });
    }

    // The saved location comes from the shared location helper (manual entry or GPS).
    // Older visits stored a bare { lat, lng } under the same key, which still parses.
    function readSavedLocation() {
        try {
            if (window.ReliefLocation) {
                const saved = window.ReliefLocation.loadLocation();
                return saved ? { lat: saved.lat, lng: saved.lng } : null;
            }
            return U.parseUserLocation(localStorage.getItem('userLocation'));
        } catch (e) {
            return null;
        }
    }

    function setStatus(message) {
        if (statusEl) statusEl.textContent = message;
    }

    function setUserMarker(location) {
        if (!map) return;
        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }
        if (location) {
            userMarker = L.marker([location.lat, location.lng]).addTo(map).bindPopup('Your Location');
        }
    }

    function initMap() {
        if (typeof L === 'undefined' || !document.getElementById('map')) return;
        const saved = readSavedLocation();
        const center = saved ? [saved.lat, saved.lng] : DEFAULT_CENTER;
        map = L.map('map').setView(center, saved ? 11 : 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        setUserMarker(saved);
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
        } else {
            const saved = readSavedLocation();
            map.setView(saved ? [saved.lat, saved.lng] : DEFAULT_CENTER, saved ? 11 : 7);
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
                    '<button type="button" class="btn-save" data-id="' + U.escapeHtml(String(f.id)) + '" aria-pressed="false" aria-label="Save ' + U.escapeHtml(f.name) + ' for offline use">Save</button>' +
                    '<button type="button" class="btn-correct" data-id="' + U.escapeHtml(String(f.id)) + '" aria-label="Suggest a correction for ' + U.escapeHtml(f.name) + '">Suggest a correction</button>' +
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
        updateSaveButtons();
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
            if (window.ReliefLocation) {
                window.ReliefLocation.saveLocation({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    source: 'gps'
                });
            } else {
                try {
                    localStorage.setItem('userLocation', JSON.stringify({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    }));
                } catch (e) { /* storage unavailable; the location is used only for this visit */ }
            }
            setUserMarker(readSavedLocation());
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
                // The correction form (facility-corrections-ui.js) fills its list from this.
                document.dispatchEvent(new CustomEvent('relief:facilities-loaded', { detail: { facilities: facilities } }));
            })
            .catch(() => showError());
    }

    hospitalsList.addEventListener('click', function(e) {
        const saveBtn = e.target.closest('.btn-save');
        if (saveBtn) {
            toggleSaved(saveBtn.getAttribute('data-id'));
            return;
        }
        const btn = e.target.closest('.btn-directions');
        if (!btn) return;
        const lat = parseFloat(btn.getAttribute('data-lat'));
        const lng = parseFloat(btn.getAttribute('data-lng'));
        if (U.isValidCoord(lat, lng)) {
            window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng, '_blank', 'noopener');
        }
    });

    // The location panel fires this when the user types a place, uses GPS or clears it
    document.addEventListener('relief:location-changed', function() {
        setUserMarker(readSavedLocation());
        if (facilities.length) applyFilters();
    });

    if (searchForm) searchForm.addEventListener('submit', e => { e.preventDefault(); applyFilters(); });
    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (filterButton) filterButton.addEventListener('click', applyFilters);
    [facilityTypeFilter, districtFilter, servicesFilter, verifiedOnly, sortSelect].forEach(el => {
        if (el) el.addEventListener('change', applyFilters);
    });
    if (locateButton) locateButton.addEventListener('click', locateUser);

    renderSavedFacilities();
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
