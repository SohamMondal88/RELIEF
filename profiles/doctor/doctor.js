document.addEventListener('DOMContentLoaded', function() {
    // Toggle availability status
    const toggleAvailabilityBtn = document.getElementById('toggle-availability');
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.availability-status span:last-child');
    
    toggleAvailabilityBtn.addEventListener('click', function() {
        if (statusIndicator.classList.contains('available')) {
            statusIndicator.classList.remove('available');
            statusIndicator.classList.add('busy');
            statusText.textContent = 'Currently Busy';
            toggleAvailabilityBtn.innerHTML = '<i class="fas fa-power-off"></i> Set as Available';
            toggleAvailabilityBtn.classList.remove('primary-btn');
            toggleAvailabilityBtn.classList.add('warning-btn');
        } else {
            statusIndicator.classList.remove('busy');
            statusIndicator.classList.add('available');
            statusText.textContent = 'Available for Consultations';
            toggleAvailabilityBtn.innerHTML = '<i class="fas fa-power-off"></i> Set as Busy';
            toggleAvailabilityBtn.classList.add('primary-btn');
            toggleAvailabilityBtn.classList.remove('warning-btn');
        }
    });

    // Simulate real-time updates
    setInterval(() => {
        // This would be replaced with actual API calls in production
        updateQueueStatus();
    }, 30000);

    function updateQueueStatus() {
        // Simulate queue updates
        const waitTimeElements = document.querySelectorAll('.wait-time');
        waitTimeElements.forEach(el => {
            const currentTime = parseInt(el.textContent);
            if (currentTime > 0) {
                el.textContent = (currentTime - 1) + ' min wait';
            }
        });
    }
});