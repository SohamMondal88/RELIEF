document.addEventListener('DOMContentLoaded', function () {
  const t = (k) => window.ReliefI18n ? ReliefI18n.t(k) : k;

  const facilities = [
    { id: 'a1', type: 'ambulance', name: 'Rapid Ambulance 24x7', status: 'available', location: 'Kolkata Central', phone: '+91 9876541001', etaMin: 7, lat: 22.5726, lng: 88.3639 },
    { id: 'a2', type: 'ambulance', name: 'City Emergency Response', status: 'busy', location: 'Salt Lake', phone: '+91 9876541002', etaMin: 12, lat: 22.5870, lng: 88.4170 },
    { id: 'a3', type: 'ambulance', name: 'GreenLine Ambulance', status: 'emergency', location: 'Howrah', phone: '+91 9876541003', etaMin: 15, lat: 22.5958, lng: 88.2636 },
    { id: 'h1', type: 'hospital', name: 'SSKM Hospital', status: 'available', location: 'Kolkata', phone: '+91 3333331111', etaMin: 10, lat: 22.5392, lng: 88.3415 },
    { id: 'h2', type: 'nursing_home', name: 'AMRI Dhakuria', status: 'busy', location: 'Dhakuria', phone: '+91 3333332222', etaMin: 11, lat: 22.5080, lng: 88.3650 },
    { id: 'c1', type: 'clinic', name: 'MedPoint Clinic', status: 'available', location: 'Dumdum', phone: '+91 3333334444', etaMin: 16, lat: 22.6200, lng: 88.4200 },
    { id: 'p1', type: 'pharmacy', name: 'LifeCare Pharmacy', status: 'available', location: 'Park Street', phone: '+91 3333335555', etaMin: 9, lat: 22.5531, lng: 88.3526 }
  ];

  const ambulanceList = document.querySelector('.ambulance-list');
  const call911Button = document.querySelector('.btn-call-911');
  const requestButton = document.querySelector('.btn-request');
  const mapEl = document.getElementById('map');
  const statusBanner = document.getElementById('auto-sos-status');

  let map; let markers = []; let activeFilter = 'all';

  function kmDistance(lat1, lon1, lat2, lon2) {
    const toRad = (x) => x * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getUserLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 7000 }
      );
    });
  }

  function iconForType(type) {
    const map = { ambulance: '🚑', hospital: '🏥', nursing_home: '🏥', clinic: '🩺', pharmacy: '💊' };
    return L.divIcon({ className: 'relief-marker-icon', html: `<span style="font-size:20px">${map[type] || '📍'}</span>`, iconSize: [24, 24] });
  }

  function renderList(items) {
    ambulanceList.innerHTML = '';
    items.filter((x) => x.type === 'ambulance').forEach((amb) => {
      const el = document.createElement('div');
      el.className = 'ambulance-item';
      el.innerHTML = `
        <div class="ambulance-info">
          <h4>${amb.name}</h4>
          <p><i class="fas fa-map-marker-alt"></i> ${amb.location}</p>
          <p><i class="fas fa-phone"></i> ${amb.phone}</p>
          <p><strong>Status:</strong> ${amb.status}</p>
          <p><strong>ETA:</strong> ~${amb.etaMin} min</p>
        </div>
        <div class="ambulance-actions">
          <button class="btn-call" data-phone="${amb.phone}"><i class="fas fa-phone"></i> Call</button>
          <button class="btn-directions" data-lat="${amb.lat}" data-lng="${amb.lng}"><i class="fas fa-directions"></i> Navigate</button>
          <button class="btn-sos" data-id="${amb.id}"><i class="fas fa-bell"></i> SOS</button>
        </div>`;
      ambulanceList.appendChild(el);
    });

    document.querySelectorAll('.btn-call').forEach((btn) => btn.onclick = () => window.open(`tel:${btn.dataset.phone}`));
    document.querySelectorAll('.btn-directions').forEach((btn) => btn.onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${btn.dataset.lat},${btn.dataset.lng}`));
    document.querySelectorAll('.btn-sos').forEach((btn) => btn.onclick = () => triggerSos(btn.dataset.id));
  }

  function updateMarkers(items) {
    markers.forEach((m) => map.removeLayer(m));
    markers = [];
    items.forEach((f) => {
      const marker = L.marker([f.lat, f.lng], { icon: iconForType(f.type) }).addTo(map);
      marker.bindPopup(`<b>${f.name}</b><br>${f.location}<br>Status: ${f.status}<br><a href="tel:${f.phone}">Call</a>`);
      markers.push(marker);
    });
    if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
  }

  function applyFilter() {
    const items = activeFilter === 'all' ? facilities : facilities.filter((f) => f.type === activeFilter);
    updateMarkers(items);
    renderList(facilities); // keep ambulance list visible
  }

  function initMap(center) {
    map = L.map(mapEl).setView(center || [22.5726, 88.3639], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    if (center) {
      L.marker([center[0], center[1]]).addTo(map).bindPopup('Your Location');
      localStorage.setItem('userLocation', JSON.stringify({ lat: center[0], lng: center[1] }));
    }
    applyFilter();
  }

  function simulateAmbulanceMotion() {
    setInterval(() => {
      facilities.filter((f) => f.type === 'ambulance').forEach((a) => {
        a.lat += (Math.random() - 0.5) * 0.01;
        a.lng += (Math.random() - 0.5) * 0.01;
      });
      applyFilter();
    }, 6000);
  }

  async function triggerSos(preferredId) {
    const userLoc = await getUserLocation() || JSON.parse(localStorage.getItem('userLocation') || 'null') || { lat: 22.5726, lng: 88.3639 };
    const ambulances = facilities.filter((f) => f.type === 'ambulance');
    let chosen = ambulances.find((a) => a.id === preferredId);
    if (!chosen) {
      chosen = ambulances.map((a) => ({ ...a, dist: kmDistance(userLoc.lat, userLoc.lng, a.lat, a.lng) })).sort((a, b) => a.dist - b.dist)[0];
    }

    const sosHistoryKey = window.AuthSession?.getCurrentUser() ? `relief_sos_history_${AuthSession.getCurrentUser().id}` : 'relief_sos_history_guest';
    const history = JSON.parse(localStorage.getItem(sosHistoryKey) || '[]');
    history.unshift({ date: new Date().toISOString(), provider: chosen.name, eta: chosen.etaMin, status: 'Triggered', location: `${userLoc.lat},${userLoc.lng}` });
    localStorage.setItem(sosHistoryKey, JSON.stringify(history));

    const contacts = window.AuthSession?.getCurrentUser() ? JSON.parse(localStorage.getItem(`relief_contacts_${AuthSession.getCurrentUser().id}`) || '[]') : [];
    const contactMsg = contacts.length ? `Contacts alert simulated for: ${contacts.map((c) => c.name).join(', ')}` : 'No emergency contacts found.';

    if (statusBanner) {
      statusBanner.classList.add('active');
      statusBanner.innerHTML = `<strong>SOS ACTIVATED</strong><br>Nearest ambulance: ${chosen.name} (~${chosen.etaMin} min).<br>${contactMsg}<br><small>Hackathon demo: dispatch and WhatsApp/SMS alerts are simulated.</small>`;
    }

    const smsField = document.getElementById('sos-sms-template');
    if (smsField) smsField.value = `SOS | RELIEF USER | ${userLoc.lat},${userLoc.lng} | Ambulance: ${chosen.name} | ETA ${chosen.etaMin} min`;

    window.open(`tel:${chosen.phone}`);
  }

  function bindFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        activeFilter = b.dataset.type;
        applyFilter();
      });
    });
  }

  call911Button?.addEventListener('click', () => triggerSos());
  requestButton?.addEventListener('click', () => alert('Opening non-emergency medical transport request flow (demo).'));

  document.getElementById('copy-sos-sms')?.addEventListener('click', async () => {
    const field = document.getElementById('sos-sms-template');
    if (!field) return;
    try { await navigator.clipboard.writeText(field.value); alert('SOS SMS copied. Send via SMS/WhatsApp.'); }
    catch { field.select(); document.execCommand('copy'); alert('SOS SMS copied.'); }
  });

  const params = new URLSearchParams(location.search);
  getUserLocation().then((loc) => {
    initMap(loc ? [loc.lat, loc.lng] : null);
    renderList(facilities);
    bindFilterButtons();
    simulateAmbulanceMotion();
    if (params.get('autoSos') === '1') triggerSos();
  });

  // Mobile menu support
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  hamburger?.addEventListener('click', function () {
    this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    navLinks?.classList.toggle('active');
  });
});
