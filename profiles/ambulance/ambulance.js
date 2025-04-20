document.addEventListener('DOMContentLoaded', function() {
    // Toggle duty status
    const toggleDutyBtn = document.getElementById('toggle-duty');
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.availability-status span:last-child');
    
    toggleDutyBtn.addEventListener('click', function() {
        if (statusIndicator.classList.contains('available')) {
            statusIndicator.classList.remove('available');
            statusIndicator.classList.add('busy');
            statusText.textContent = 'Off Duty';
            toggleDutyBtn.innerHTML = '<i class="fas fa-power-off"></i> Go Online';
            toggleDutyBtn.classList.remove('emergency-btn');
            toggleDutyBtn.classList.add('outline-btn');
            
            // Simulate ending all active cases
            document.querySelector('.active-case').innerHTML = `
                <h2><i class="fas fa-bell"></i> Current Emergency</h2>
                <div class="no-case">
                    <i class="fas fa-bed" style="font-size: 2rem; color: #95a5a6;"></i>
                    <p>No active emergencies</p>
                </div>
            `;
        } else {
            statusIndicator.classList.remove('busy');
            statusIndicator.classList.add('available');
            statusText.textContent = 'On Duty';
            toggleDutyBtn.innerHTML = '<i class="fas fa-power-off"></i> Go Offline';
            toggleDutyBtn.classList.add('emergency-btn');
            toggleDutyBtn.classList.remove('outline-btn');
            
            // Simulate receiving a new case
            document.querySelector('.active-case').innerHTML = `
                <h2><i class="fas fa-bell"></i> Current Emergency</h2>
                <div class="case-details">
                    <div class="case-header">
                        <span class="priority high">HIGH PRIORITY</span>
                        <span class="case-time">Received: Just now</span>
                    </div>
                    <div class="case-info">
                        <h3>Cardiac Emergency</h3>
                        <p><i class="fas fa-user"></i> Patient: Ramesh Patel (62 yrs)</p>
                        <p><i class="fas fa-map-marker-alt"></i> 1.2km away - 24 Park Street</p>
                        <p><i class="fas fa-phone"></i> Contact: +91 98765 43210</p>
                    </div>
                    <div class="case-actions">
                        <button class="btn primary-btn">
                            <i class="fas fa-map-marked-alt"></i> Navigate
                        </button>
                        <button class="btn outline-btn">
                            <i class="fas fa-check-circle"></i> Mark En Route
                        </button>
                    </div>
                </div>
            `;
        }
    });

    // Simulate real-time case updates
    setInterval(() => {
        const caseTimeElement = document.querySelector('.case-time');
        if (caseTimeElement && caseTimeElement.textContent.includes('min')) {
            const mins = parseInt(caseTimeElement.textContent);
            caseTimeElement.textContent = `Received: ${mins + 1} min ago`;
        }
    }, 60000);
});