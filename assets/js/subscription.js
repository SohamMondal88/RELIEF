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
});
