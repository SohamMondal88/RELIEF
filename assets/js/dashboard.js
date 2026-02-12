document.addEventListener('DOMContentLoaded', () => {
  if (!window.AuthSession || !AuthSession.requireAuth('./login.html')) return;
  const user = AuthSession.getCurrentUser();
  document.getElementById('profile-name').textContent = user?.name || 'User';
  document.getElementById('profile-email').textContent = user?.email || '-';
  document.getElementById('profile-role').textContent = user?.role || 'user';

  const remindersKey = `relief_reminders_${user.id}`;
  const timelineKey = `relief_timeline_${user.id}`;
  const appointmentsKey = `relief_appointments_${user.id}`;
  const savedKey = `relief_saved_${user.id}`;
  const ambulanceKey = `relief_ambulance_${user.id}`;

  const reminders = JSON.parse(localStorage.getItem(remindersKey) || '[]');
  const timeline = JSON.parse(localStorage.getItem(timelineKey) || '[]');
  const appointments = JSON.parse(localStorage.getItem(appointmentsKey) || '[{"date":"2026-03-14","doctor":"Dr. Arijit Sen","type":"General Consultation"}]');
  const saved = JSON.parse(localStorage.getItem(savedKey) || '["Peerless Hospital, Kolkata","Dr. S. Chatterjee - Cardiology"]');
  const ambulance = JSON.parse(localStorage.getItem(ambulanceKey) || '[{"date":"2026-01-12","status":"Resolved","location":"Salt Lake"}]');

  function persist() {
    localStorage.setItem(remindersKey, JSON.stringify(reminders));
    localStorage.setItem(timelineKey, JSON.stringify(timeline));
  }

  function render() {
    const reminderList = document.getElementById('reminder-list');
    reminderList.innerHTML = reminders.length ? reminders.map((r, i) => `<li>${r.medicine} at ${r.time} <button data-done='${i}'>Done</button></li>`).join('') : '<li>No reminders yet.</li>';

    document.getElementById('timeline-body').innerHTML = timeline.length ? timeline.map((t) => `<tr><td>${t.date}</td><td>${t.event}</td><td>${t.status}</td></tr>`).join('') : '<tr><td colspan="3">No history yet.</td></tr>';
    document.getElementById('appointments-list').innerHTML = appointments.map((a) => `<li>${a.date} - ${a.doctor} (${a.type})</li>`).join('');
    document.getElementById('saved-list').innerHTML = saved.map((s) => `<li>${s}</li>`).join('');
    document.getElementById('ambulance-list').innerHTML = ambulance.map((a) => `<li>${a.date} - ${a.location} (${a.status})</li>`).join('');

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

  document.getElementById('reminder-list').addEventListener('click', (e) => {
    const idx = e.target.dataset.done;
    if (idx === undefined) return;
    const removed = reminders.splice(Number(idx), 1)[0];
    timeline.unshift({ date: new Date().toISOString().slice(0, 10), event: 'Medication completed', status: removed.medicine });
    persist();
    render();
  });

  document.getElementById('save-settings').addEventListener('click', () => {
    const largeText = document.getElementById('setting-large-text').checked;
    const highContrast = document.getElementById('setting-high-contrast').checked;
    document.body.classList.toggle('large-text', largeText);
    document.body.classList.toggle('high-contrast', highContrast);
    localStorage.setItem(`relief_settings_${user.id}`, JSON.stringify({ largeText, highContrast }));
    alert('Settings saved');
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    AuthSession.logout();
    window.location.href = './login.html';
  });

  render();
});
