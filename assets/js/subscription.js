/**
 * Subscription page and dashboard plan summary.
 *
 * What a person has paid for is decided by the server (see subscription-state.js
 * and docs/SUBSCRIPTION_SERVER_CONTRACT.md). This file only shows the answer.
 * It never reads or writes the plan, payment status or benefits in browser
 * storage, and never takes them from the URL.
 */
document.addEventListener('DOMContentLoaded', () => {
    const billingButtons = document.querySelectorAll('[data-billing]');
    const prices = document.querySelectorAll('.price');

    billingButtons.forEach(button => {
        button.addEventListener('click', () => {
            billingButtons.forEach(item => item.classList.remove('active'));
            button.classList.add('active');

            const billingType = button.dataset.billing;
            prices.forEach(price => {
                const value = billingType === 'yearly' ? price.dataset.yearly : price.dataset.monthly;
                if (value) {
                    price.textContent = value;
                }
            });
        });
    });

    const S = window.ReliefSubscription;
    if (!S) return;

    const panel = document.getElementById('subscription-status');
    const summary = document.getElementById('plan-summary');
    if (!panel && !summary) return;

    let checking = false;

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function renderPanel(result) {
        if (!panel) return;
        const info = S.describe(result);
        panel.dataset.state = result.state;
        panel.dataset.tone = info.tone;
        setText('subscription-status-title', info.title);
        setText('subscription-status-message', info.message);
        const retry = document.getElementById('subscription-recheck');
        if (retry) retry.hidden = !info.retry;
    }

    // Dashboard card: lists benefits only for a verified active plan.
    function renderSummary(result) {
        if (!summary) return;
        const info = S.describe(result);
        setText('plan-summary-status', info.title + '. ' + info.message);
        const list = document.getElementById('plan-benefits');
        if (!list) return;
        list.textContent = '';
        S.entitlements(result).forEach(id => {
            const item = document.createElement('li');
            item.textContent = '✔ ' + S.featureLabel(id);
            list.appendChild(item);
        });
        list.hidden = list.children.length === 0;
    }

    function renderChecking() {
        const result = S.unknown('checking');
        if (panel) {
            panel.dataset.state = 'checking';
            panel.dataset.tone = 'info';
            setText('subscription-status-title', 'Checking your subscription');
            setText('subscription-status-message', 'Asking the server. Plan benefits stay off until it answers.');
            const retry = document.getElementById('subscription-recheck');
            if (retry) retry.hidden = true;
        }
        if (summary) {
            setText('plan-summary-status', 'Checking your plan with the server...');
            const list = document.getElementById('plan-benefits');
            if (list) { list.textContent = ''; list.hidden = true; }
        }
        return result;
    }

    function check() {
        if (checking) return;
        checking = true;
        renderChecking();
        S.verify().then(result => {
            renderPanel(result);
            renderSummary(result);
        }).then(() => { checking = false; }, () => { checking = false; });
    }

    const recheck = document.getElementById('subscription-recheck');
    if (recheck) recheck.addEventListener('click', check);
    check();
});
