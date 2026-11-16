document.addEventListener('DOMContentLoaded', function() {
    const U = window.FacilityUtils;
    const DATA_URL = '../assets/data/facilities.json';
    const R = typeof ReliefResilience !== 'undefined' ? ReliefResilience : null;
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
    let reviewPolicy = U.getReviewPolicy(null);
    let map = null;
    let markers = [];
    let userMarker = null;

    // Saved facilities live in this browser only (ReliefSaved, assets/js/saved-facilities.js). There is no
    // account sync, and the panel says so. The list works offline as a saved copy.
    const S = window.ReliefSaved;
    const savedList = document.getElementById('saved-facilities-list');
    const savedNotes = document.getElementById('saved-notes');
    const savedStatus = document.getElementById('saved-status');
    const savedHeading = document.getElementById('saved-heading');
    // 'loading' until facilities.json answers, then 'ready' or 'failed'. It decides whether a saved
    // facility can be compared with the directory.
    let directoryState = 'loading';

    function getStorage() {
        try { return window.localStorage; } catch (error) { return null; }
    }

    function readSaved() {
        const store = getStorage();
        return store ? S.read(store) : { items: [], dropped: 0, unreadable: false, unavailable: true };
    }

    function setSavedStatus(message) {
        if (savedStatus) savedStatus.textContent = message;
    }

    function isSignedIn() {
        try {
            return Boolean(window.ReliefSession && window.ReliefSession.getCurrentSession && window.ReliefSession.getCurrentSession());
        } catch (error) {
            return false;
        }
    }

    function addLine(parent, className, text) {
        const p = document.createElement('p');
        p.className = className;
        p.textContent = text;
        parent.appendChild(p);
        return p;
    }

    function renderSavedFacilities() {
        if (!savedList || !S) return;
        const saved = readSaved();
        if (savedNotes) {
            savedNotes.textContent = '';
            S.syncNotes({ signedIn: isSignedIn(), online: navigator.onLine !== false, unavailable: saved.unavailable })
                .forEach(line => addLine(savedNotes, 'saved-note', line));
        }
        savedList.textContent = '';
        if (saved.unreadable) {
            addLine(savedList, 'saved-warning', 'Your saved list could not be read, so it is shown empty. Saving a facility again starts a fresh list.');
        } else if (saved.dropped > 0) {
            addLine(savedList, 'saved-warning', saved.dropped + (saved.dropped === 1 ? ' saved entry was broken or repeated and is not shown.' : ' saved entries were broken or repeated and are not shown.'));
        }

        if (saved.items.length === 0) {
            addLine(savedList, 'saved-empty', 'No saved facilities yet. Use Save on a hospital below.');
            return;
        }

        const rows = S.reconcile(saved.items, directoryState === 'ready' ? facilities : null);
        rows.forEach(row => {
            const item = row.item;
            const el = document.createElement('div');
            el.className = 'saved-item';

            const name = document.createElement('strong');
            name.textContent = item.name;
            el.appendChild(name);
            if (item.location) {
                const location = document.createElement('div');
                location.textContent = item.location;
                el.appendChild(location);
            }
            const when = item.savedAt ? ', added ' + new Date(item.savedAt).toLocaleDateString() : '';
            addLine(el, 'saved-meta', 'Saved copy' + when + '. Details may have changed since.');
            if (row.status === 'missing') {
                addLine(el, 'saved-warning', 'No longer listed in the directory. The details below are your saved copy and may be out of date, so call to check before you travel.');
            } else if (row.status === 'unchecked' && directoryState === 'failed') {
                addLine(el, 'saved-warning', 'The directory could not be loaded, so this saved copy could not be checked against it.');
            }

            if (item.phone) {
                const call = document.createElement('a');
                call.href = 'tel:' + String(item.phone).replace(/[^\d+]/g, '');
                call.textContent = 'Call ' + item.phone;
                el.appendChild(call);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-save is-saved';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label', 'Remove ' + item.name + ' from saved facilities');
            remove.addEventListener('click', () => removeSaved(String(item.id), item.name));
            el.appendChild(remove);

            savedList.appendChild(el);
        });
    }

    function afterSavedChange() {
        renderSavedFacilities();
        updateSaveButtons();
    }

    function toggleSaved(id) {
        const facility = facilities.find(f => f.id === id);
        const store = getStorage();
        if (!facility) {
            setSavedStatus('That facility is not in the list right now, so it could not be saved.');
            return;
        }
        const result = store ? S.toggle(store, facility) : { ok: false };
        if (!result.ok) {
            setSavedStatus('Could not save ' + facility.name + ' on this device (the browser blocked storage or it is full). Your saved list was not changed.');
        } else if (result.saved) {
            setSavedStatus('Saved ' + facility.name + '. It is kept on this device only.');
        } else {
            setSavedStatus('Removed ' + facility.name + ' from your saved facilities.');
        }
        afterSavedChange();
    }

    function removeSaved(id, name) {
        const store = getStorage();
        const result = store ? S.remove(store, id) : { ok: false };
        setSavedStatus(result.ok
            ? 'Removed ' + name + ' from your saved facilities.'
            : 'Could not remove ' + name + ' (the browser blocked storage). Your saved list was not changed.');
        afterSavedChange();
        // The button that was pressed is gone, so keep keyboard users in the panel.
        if (savedHeading) savedHeading.focus();
    }

    function updateSaveButtons() {
        const savedIds = new Set(readSaved().items.map(item => String(item.id)));
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
        const mapEl = document.getElementById('map');
        if (!mapEl) return;
        if (typeof L === 'undefined') {
            // The map library did not load (offline, blocked). The list below still works.
            mapEl.textContent = 'The map could not be loaded. The facility list below still works.';
            return;
        }
        try {
            const saved = readSavedLocation();
            const center = saved ? [saved.lat, saved.lng] : DEFAULT_CENTER;
            map = L.map('map').setView(center, saved ? 11 : 7);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(map);
            setUserMarker(saved);
        } catch (error) {
            map = null;
            if (R) R.logError('hospitals map init', error);
            mapEl.textContent = 'The map could not be shown. The facility list below still works.';
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
        // The label comes from the review state and the check date, never from a bare flag.
        const label = U.reviewLabel(f, { policy: reviewPolicy });
        const badgeClass = 'badge-' + (label.state === 'pending' ? 'unverified' : label.state);
        const badgeText = label.badge;
        const detail = label.detail;
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
                    '<button type="button" class="btn-save" data-id="' + U.escapeHtml(String(f.id)) + '" aria-pressed="false" aria-label="Save ' + U.escapeHtml(f.name) + ' on this device">Save</button>' +
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
            verifiedOnly: verifiedOnly ? verifiedOnly.checked : false,
            policy: reviewPolicy
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
            const coords = pos && pos.coords;
            if (!coords || !U.isValidCoord(coords.latitude, coords.longitude)) {
                setStatus('Your device gave an unusable position, so it was ignored. Showing facilities sorted by name.');
                return;
            }
            if (window.ReliefLocation) {
                window.ReliefLocation.saveLocation({
                    lat: coords.latitude,
                    lng: coords.longitude,
                    source: 'gps'
                });
            } else {
                try {
                    localStorage.setItem('userLocation', JSON.stringify({
                        lat: coords.latitude,
                        lng: coords.longitude
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

    function showLoading(message) {
        const text = message || 'Loading facilities...';
        if (R) R.renderState(hospitalsList, { state: 'loading', message: text });
        else hospitalsList.innerHTML = '<p class="loading-state">' + text + '</p>';
        setStatus(text);
    }

    // `error` is whatever failed: a fetch/HTTP failure, or bad data. It decides the wording
    // (offline / timeout / server) and whether a retry makes sense.
    function showError(error) {
        const info = R ? R.classify(error) : null;
        if (R) {
            R.renderState(hospitalsList, {
                state: 'error',
                error: info,
                // Facility data is used when people need care, so always say what to do if it is urgent.
                emergency: true
            }, loadFacilities);
        } else {
            hospitalsList.innerHTML = '<div class="error-state" role="alert"><p>The facility list could not be loaded. Check your connection and try again.</p></div>';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'btn-filter';
            retry.textContent = 'Retry';
            retry.addEventListener('click', loadFacilities);
            hospitalsList.firstChild.appendChild(retry);
        }
        setStatus(info ? info.title + '. ' + info.message : 'The facility list could not be loaded.');
    }

    // Plain fetch that reports HTTP failures with a status, so they can be told apart.
    function fetchFacilities() {
        const timeoutMs = 10000;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timedOut = false;
        const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
        return fetch(DATA_URL, controller ? { signal: controller.signal } : undefined)
            .then(res => {
                if (!res.ok) {
                    const err = new Error('HTTP ' + res.status);
                    err.status = res.status;
                    err.requestId = R ? R.extractRequestId(res) : null;
                    throw err;
                }
                return res.json().catch(() => {
                    const err = new Error('Bad facility data');
                    err.code = 'backend-unavailable';
                    err.reason = 'bad-answer';
                    throw err;
                });
            })
            .catch(err => {
                if (timedOut) { const e = new Error('timeout'); e.reason = 'timeout'; throw e; }
                if (!err.status && !err.reason && navigator.onLine === false) err.reason = 'offline';
                throw err;
            })
            .finally(() => { if (timer) clearTimeout(timer); });
    }

    function loadFacilities() {
        showLoading();
        // Reading a static file is safe to repeat, so transient failures are retried quietly first.
        const load = R
            ? R.retry(fetchFacilities, {
                method: 'GET',
                onRetry: (info) => showLoading('Still trying to load facilities (attempt ' + (info.attempt + 1) + ')...')
            })
            : fetchFacilities();
        load
            .then(data => {
                // Records that break the data contract are left out instead of breaking the page.
                const checked = window.FacilitySchema ? window.FacilitySchema.validateDataset(data) : null;
                if (checked && !checked.ok) throw new Error('Facility data is not usable: ' + checked.problems.join('; '));
                if (checked && checked.quarantined.length > 0) {
                    console.warn('Skipped ' + checked.quarantined.length + ' facility record(s) that break the data contract:',
                        checked.quarantined.map(q => (q.id || '#' + q.index) + ' (' + q.errors.join(', ') + ')'));
                }
                facilities = U.normalizeFacilities(checked ? checked.accepted : data);
                reviewPolicy = U.getReviewPolicy(data);
                directoryState = 'ready';
                renderSavedFacilities();
                populateFilters();
                applyFilters();
                // The correction form (facility-corrections-ui.js) fills its list from this.
                document.dispatchEvent(new CustomEvent('relief:facilities-loaded', { detail: { facilities: facilities } }));
            })
            .catch(error => {
                if (R) R.logError('hospitals load', error, { url: R.safeUrl(DATA_URL) });
                directoryState = 'failed';
                renderSavedFacilities();
                showError(error);
            });
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

    // The same list is shown in the cards and in the panel, and another tab can change it, so follow the storage event.
    window.addEventListener('storage', function(e) {
        if (e.key === null || (S && e.key === S.KEY)) afterSavedChange();
    });
    window.addEventListener('online', renderSavedFacilities);
    window.addEventListener('offline', renderSavedFacilities);

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
