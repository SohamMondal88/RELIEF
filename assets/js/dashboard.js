document.addEventListener('DOMContentLoaded', () => {
  if (!window.AuthSession || !AuthSession.requireAuth('./login.html')) return;
  const user = AuthSession.getCurrentUser();
  document.getElementById('profile-name').textContent = user?.name || 'User';
  document.getElementById('profile-email').textContent = user?.email || '-';
  document.getElementById('profile-role').textContent = user?.role || 'user';

  const keys = {
    reminders: `relief_reminders_${user.id}`,
    timeline: `relief_timeline_${user.id}`,
    appointments: `relief_appointments_${user.id}`,
    saved: `relief_saved_${user.id}`,
    ambulance: `relief_ambulance_${user.id}`,
    contacts: `relief_contacts_${user.id}`,
    symptoms: `relief_symptom_history_${user.id}`,
    settings: `relief_settings_${user.id}`,
    profile: `relief_profile_${user.id}`
  };

  const reminders = JSON.parse(localStorage.getItem(keys.reminders) || '[]');
  const timeline = JSON.parse(localStorage.getItem(keys.timeline) || '[]');
  const appointments = JSON.parse(localStorage.getItem(keys.appointments) || '[{"date":"2026-03-14","doctor":"Dr. Arijit Sen","type":"General Consultation"}]');
  const saved = JSON.parse(localStorage.getItem(keys.saved) || '["Peerless Hospital, Kolkata","Dr. S. Chatterjee - Cardiology"]');
  const ambulance = JSON.parse(localStorage.getItem(keys.ambulance) || '[{"date":"2026-01-12","status":"Resolved","location":"Salt Lake"}]');
  const contacts = JSON.parse(localStorage.getItem(keys.contacts) || '[{"name":"Family Contact","phone":"+91 90000 00000"}]');
  const symptoms = JSON.parse(localStorage.getItem(keys.symptoms) || '[{"date":"2026-02-03","summary":"Fever + cough","advice":"Doctor consult in 24h"}]');
  const profile = JSON.parse(localStorage.getItem(keys.profile) || '{}');

  function persist() {
    localStorage.setItem(keys.reminders, JSON.stringify(reminders));
    localStorage.setItem(keys.timeline, JSON.stringify(timeline));
    localStorage.setItem(keys.contacts, JSON.stringify(contacts));
  }

  document.getElementById('age').value = profile.age || '';
  document.getElementById('blood-group').value = profile.bloodGroup || '';
  document.getElementById('allergies').value = profile.allergies || '';

  function render() {
    document.getElementById('reminder-list').innerHTML = reminders.length
      ? reminders.map((r, i) => `<li>${r.medicine} at ${r.time} <button data-done='${i}'>Done</button></li>`).join('')
      : '<li>No reminders yet.</li>';

    document.getElementById('timeline-body').innerHTML = timeline.length
      ? timeline.map((t) => `<tr><td>${t.date}</td><td>${t.event}</td><td>${t.status}</td></tr>`).join('')
      : '<tr><td colspan="3">No history yet.</td></tr>';

    document.getElementById('appointments-list').innerHTML = appointments.map((a) => `<li>${a.date} - ${a.doctor} (${a.type})</li>`).join('');
    document.getElementById('saved-list').innerHTML = saved.map((s) => `<li>${s}</li>`).join('');
    document.getElementById('ambulance-list').innerHTML = ambulance.map((a) => `<li>${a.date} - ${a.location} (${a.status})</li>`).join('');
    document.getElementById('contacts-list').innerHTML = contacts.map((c) => `<li>${c.name} — <a href="tel:${c.phone}">${c.phone}</a></li>`).join('');
    document.getElementById('symptoms-list').innerHTML = symptoms.map((s) => `<li>${s.date}: ${s.summary} <em>(${s.advice})</em></li>`).join('');

    document.getElementById('kpi-reminders').textContent = reminders.length;
    document.getElementById('kpi-appointments').textContent = appointments.length;
    document.getElementById('kpi-ambulance').textContent = ambulance.length;
  }

  document.getElementById('reminder-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const medicine = document.getElementById('medicine').value.trim();
    const time = document.getElementById('time').value;
    if (!medicine || !time) return;
    reminders.push({ medicine, time });
    timeline.unshift({ date: new Date().toISOString().slice(0, 10), event: 'Medication reminder added', status: `${medicine} at ${time}` });
    persist();
    e.target.reset();
    render();
  });

  document.getElementById('health-profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    profile.age = document.getElementById('age').value;
    profile.bloodGroup = document.getElementById('blood-group').value.trim();
    profile.allergies = document.getElementById('allergies').value.trim();
    localStorage.setItem(keys.profile, JSON.stringify(profile));
    timeline.unshift({ date: new Date().toISOString().slice(0, 10), event: 'Health profile updated', status: `${profile.bloodGroup || 'N/A'} / ${profile.allergies || 'No allergies listed'}` });
    persist();
    alert('Profile saved');
    render();
  });

  document.getElementById('contact-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    if (!name || !/^\+?[0-9\-\s]{7,20}$/.test(phone)) {
      alert('Enter valid emergency contact.');
      return;
    }
    contacts.push({ name, phone });
    timeline.unshift({ date: new Date().toISOString().slice(0, 10), event: 'Emergency contact added', status: name });
    persist();
    e.target.reset();
    render();
  });

  document.getElementById('reminder-list').addEventListener('click', (e) => {
    const idx = e.target.dataset.done;
    if (idx === undefined) return;
    const removed = reminders.splice(Number(idx), 1)[0];
    timeline.unshift({ date: new Date().toISOString().slice(0, 10), event: 'Medication completed', status: removed.medicine });
    persist();
    render();
  });

  const savedSettings = JSON.parse(localStorage.getItem(keys.settings) || '{}');
  document.getElementById('setting-large-text').checked = Boolean(savedSettings.largeText);
  document.getElementById('setting-high-contrast').checked = Boolean(savedSettings.highContrast);
  document.body.classList.toggle('large-text', Boolean(savedSettings.largeText));
  document.body.classList.toggle('high-contrast', Boolean(savedSettings.highContrast));

  document.getElementById('save-settings').addEventListener('click', () => {
    const largeText = document.getElementById('setting-large-text').checked;
    const highContrast = document.getElementById('setting-high-contrast').checked;
    document.body.classList.toggle('large-text', largeText);
    document.body.classList.toggle('high-contrast', highContrast);
    localStorage.setItem(keys.settings, JSON.stringify({ largeText, highContrast }));
    alert('Settings saved');
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    AuthSession.logout();
    window.location.href = './login.html';
  });

  render();
});
