document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reminder-form');
    const list = document.getElementById('reminder-list');
    const timeline = document.getElementById('timeline');
    const kpiReminders = document.getElementById('kpi-reminders');

    const key = 'relief_reminders_v1';
    const historyKey = 'relief_history_v1';

    const reminders = JSON.parse(localStorage.getItem(key) || '[]');
    const history = JSON.parse(localStorage.getItem(historyKey) || '[{"date":"2026-01-02","event":"Symptom check completed","status":"Advised doctor consult"},{"date":"2026-01-04","event":"Appointment booked","status":"Dr. A. Sen - 10:30 AM"}]');

    function render() {
        list.innerHTML = reminders.length
            ? reminders.map((r, i) => `
                <li class="reminder-item">
                    <div><strong>${r.medicine}</strong><div class="muted">${r.time}</div></div>
                    <button data-i="${i}" class="btn">Done</button>
                </li>
            `).join('')
            : '<li class="muted">No reminders yet.</li>';

        timeline.innerHTML = history.map(h => `<tr><td>${h.date}</td><td>${h.event}</td><td>${h.status}</td></tr>`).join('');

        if (kpiReminders) {
            kpiReminders.textContent = reminders.length;
        }

        localStorage.setItem(key, JSON.stringify(reminders));
        localStorage.setItem(historyKey, JSON.stringify(history));
    }

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const medicine = document.getElementById('medicine').value.trim();
        const time = document.getElementById('time').value;

        if (!medicine || !time) return;

        reminders.push({ medicine, time });
        history.unshift({
            date: new Date().toISOString().slice(0, 10),
            event: 'Medication reminder created',
            status: `${medicine} at ${time}`
        });
        form.reset();
        render();
    });

    list?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-i]');
        if (!btn) return;

        const i = Number(btn.dataset.i);
        const item = reminders.splice(i, 1)[0];
        if (item) {
            history.unshift({
                date: new Date().toISOString().slice(0, 10),
                event: 'Reminder marked done',
                status: item.medicine
            });
        }

        render();
    });

    initializeChatbot();
    render();
});

function initializeChatbot() {
    const form = document.getElementById('chatbot-form');
    const input = document.getElementById('chatbot-input');
    const messages = document.getElementById('chatbot-messages');
    const chips = document.querySelectorAll('.chip[data-chat]');

    if (!form || !input || !messages) return;

    appendMessage('bot', 'Hi! I’m Relief Assistant. I can help with doctors, hospitals, first aid, and subscriptions.');

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        appendMessage('user', text);
        appendMessage('bot', getBotResponse(text));
        input.value = '';
    });

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.chat;
            appendMessage('user', prompt);
            appendMessage('bot', getBotResponse(prompt));
        });
    });

    function appendMessage(sender, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender}`;
        bubble.textContent = text;
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
    }
}

function getBotResponse(input) {
    const q = input.toLowerCase();

    if (q.includes('hospital')) {
        return 'Use the Hospitals page to find nearest facilities. Keep location enabled for best results.';
    }

    if (q.includes('doctor') || q.includes('appointment')) {
        return 'Go to Find Doctors to filter by specialty and book a consultation in minutes.';
    }

    if (q.includes('first aid')) {
        return 'For immediate support, open First Aid guides. For severe symptoms, call emergency services right away.';
    }

    if (q.includes('subscription') || q.includes('plan')) {
        return 'You can compare plans on the Subscription page and upgrade instantly.';
    }

    return 'I can help with doctors, hospitals, first aid, and subscriptions. Try asking: “Find nearby hospitals”.';
}
