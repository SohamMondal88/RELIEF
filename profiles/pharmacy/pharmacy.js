document.addEventListener('DOMContentLoaded', function() {
    // Handle order actions
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn.small-btn')) {
            const orderItem = e.target.closest('.order-item');
            if (e.target.textContent.includes('Mark Collected')) {
                orderItem.style.opacity = '0.5';
                setTimeout(() => {
                    orderItem.remove();
                    updateOrderCount();
                }, 500);
            }
        }
    });

    function updateOrderCount() {
        const orderCount = document.querySelectorAll('.order-item').length;
        document.querySelector('.pending-orders h2').textContent = 
            `Pending Orders (${orderCount})`;
    }

    // Simulate inventory updates
    setInterval(() => {
        const statValues = document.querySelectorAll('.stat-value');
        if (statValues[0]) {
            statValues[0].textContent = parseInt(statValues[0].textContent) + 1;
        }
    }, 300000); // Every 5 minutes
});