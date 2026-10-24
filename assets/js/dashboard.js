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
    const clearBtn = document.getElementById('chatbot-clear');

    if (!form || !input || !messages) return;

    function appendBubble(sender, text, options) {
        const opts = options || {};
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ' + sender + (opts.alert ? ' urgent' : '');
        if (opts.alert) bubble.setAttribute('role', 'alert');
        const p = document.createElement('p');
        p.textContent = text;
        bubble.appendChild(p);
        (opts.links || []).forEach(function (link) {
            const a = document.createElement('a');
            a.href = link.href;
            a.textContent = link.label;
            a.className = 'chat-link';
            bubble.appendChild(a);
        });
        if (opts.retry) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chip';
            btn.textContent = 'Retry';
            btn.addEventListener('click', function () {
                bubble.remove();
                send(opts.retry);
            });
            bubble.appendChild(btn);
        }
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
    }

    function send(text) {
        const assistant = window.ReliefAssistant;
        const result = assistant
            ? assistant.safeRoute(text)
            : { text: 'The assistant could not load. Please reload the page. If this is an emergency, call local emergency services now.', links: [] };
        appendBubble('bot', result.text, {
            alert: result.alert,
            links: result.links,
            retry: result.retry ? text : null
        });
    }

    function ask(text) {
        appendBubble('user', text);
        send(text);
    }

    function greet() {
        appendBubble('bot', 'Hi, I’m Relief Assistant. I can point you to doctors, hospitals, first aid and plans. I can’t give medical advice.');
    }

    greet();

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        ask(text);
        input.value = '';
    });

    chips.forEach(chip => {
        chip.addEventListener('click', () => ask(chip.dataset.chat));
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            messages.textContent = '';
            greet();
            input.focus();
        });
    }
}
