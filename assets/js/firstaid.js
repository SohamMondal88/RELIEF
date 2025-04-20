document.addEventListener('DOMContentLoaded', function() {
    // First aid guide data
    const firstAidGuides = [
        {
            id: 1,
            title: "How to Perform CPR",
            category: "cpr",
            content: `
                <p>Cardiopulmonary resuscitation (CPR) can save lives when someone's breathing or heartbeat has stopped.</p>
                <div class="guide-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Call emergency services before starting CPR if possible.</span>
                </div>
                <h5>Steps:</h5>
                <ol class="guide-steps">
                    <li>Place the person on their back on a firm surface.</li>
                    <li>Kneel next to the person's neck and shoulders.</li>
                    <li>Place the heel of one hand on the center of the person's chest.</li>
                    <li>Place your other hand on top of the first hand and interlock your fingers.</li>
                    <li>Position your shoulders directly over your hands and keep your arms straight.</li>
                    <li>Push hard and fast - at least 2 inches deep and at a rate of 100-120 compressions per minute.</li>
                    <li>After 30 compressions, give 2 rescue breaths (if trained).</li>
                    <li>Continue until the person starts breathing or help arrives.</li>
                </ol>
            `
        },
        {
            id: 2,
            title: "Treating Burns",
            category: "burns",
            content: `
                <p>Proper first aid for burns can help reduce pain and prevent complications.</p>
                <h5>For Minor Burns:</h5>
                <ol class="guide-steps">
                    <li>Cool the burn with cool (not cold) running water for 10-15 minutes.</li>
                    <li>Remove jewelry or tight clothing near the burned area.</li>
                    <li>Apply a sterile non-stick dressing or clean cloth.</li>
                    <li>Take over-the-counter pain relievers if needed.</li>
                </ol>
                <div class="guide-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Do NOT use ice, butter, or ointments on serious burns.</span>
                </div>
                <h5>For Severe Burns:</h5>
                <ol class="guide-steps">
                    <li>Call emergency services immediately.</li>
                    <li>Protect the person from further harm.</li>
                    <li>Check for breathing and perform CPR if needed.</li>
                    <li>Remove jewelry and tight clothing (unless stuck to the burn).</li>
                    <li>Cover the burn loosely with a clean, dry cloth.</li>
                </ol>
            `
        },
        {
            id: 3,
            title: "First Aid for Choking",
            category: "choking",
            content: `
                <p>When someone is choking, quick action can save their life.</p>
                <h5>For Adults and Children Over 1 Year:</h5>
                <ol class="guide-steps">
                    <li>Ask "Are you choking?" If they can cough or speak, don't interfere.</li>
                    <li>If they can't breathe, stand behind them and wrap your arms around their waist.</li>
                    <li>Make a fist with one hand and place it just above their navel.</li>
                    <li>Grasp your fist with your other hand and give quick, upward thrusts.</li>
                    <li>Continue until the object is expelled or they become unconscious.</li>
                </ol>
                <h5>For Infants Under 1 Year:</h5>
                <ol class="guide-steps">
                    <li>Place the baby face down on your forearm, supporting their head and jaw.</li>
                    <li>Give up to 5 back blows between the shoulder blades with the heel of your hand.</li>
                    <li>If object isn't expelled, turn baby face up on your thigh and give up to 5 chest thrusts.</li>
                    <li>Alternate between back blows and chest thrusts until object is expelled or baby becomes unresponsive.</li>
                </ol>
                <div class="guide-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>If the person becomes unconscious, call emergency services and begin CPR.</span>
                </div>
            `
        },
        {
            id: 4,
            title: "Treating Cuts and Scrapes",
            category: "cuts",
            content: `
                <p>Proper wound care can prevent infection and promote healing.</p>
                <h5>Steps:</h5>
                <ol class="guide-steps">
                    <li>Wash your hands with soap and water.</li>
                    <li>Apply gentle pressure with a clean cloth to stop bleeding.</li>
                    <li>Clean the wound with cool running water (avoid hydrogen peroxide or iodine).</li>
                    <li>Remove any debris with cleaned tweezers.</li>
                    <li>Apply antibiotic ointment if available.</li>
                    <li>Cover with a sterile bandage or gauze.</li>
                    <li>Change the dressing daily or when it becomes wet or dirty.</li>
                </ol>
                <div class="guide-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Seek medical attention for deep wounds, wounds that won't stop bleeding, or signs of infection.</span>
                </div>
            `
        },
        {
            id: 5,
            title: "Treating Fractures",
            category: "fractures",
            content: `
                <p>Proper immobilization can prevent further injury until medical help arrives.</p>
                <h5>Steps:</h5>
                <ol class="guide-steps">
                    <li>Call emergency services for severe fractures.</li>
                    <li>Keep the person still and calm.</li>
                    <li>If there's bleeding, apply pressure with a clean cloth.</li>
                    <li>Apply ice wrapped in cloth to reduce swelling.</li>
                    <li>Immobilize the injured area with a splint or sling if possible.</li>
                    <li>Do NOT try to realign the bone or push a protruding bone back in.</li>
                </ol>
                <div class="guide-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>For suspected neck or back injuries, do NOT move the person unless absolutely necessary.</span>
                </div>
            `
        }
    ];

    // DOM elements
    const guidesAccordion = document.querySelector('.guides-accordion');
    const searchInput = document.querySelector('.search-guides input');
    const searchButton = document.querySelector('.search-guides button');
    const categoryCards = document.querySelectorAll('.category-card');
    const resetButton = document.querySelector('.reset-search');

    // Display all guides initially
    displayGuides(firstAidGuides);

    // Filter guides based on search
    function filterGuides() {
        const searchTerm = searchInput.value.trim().toLowerCase();
        
        if (!searchTerm) {
            displayGuides(firstAidGuides);
            return;
        }

        const filteredGuides = firstAidGuides.filter(guide => 
            guide.title.toLowerCase().includes(searchTerm) || 
            guide.content.toLowerCase().includes(searchTerm)
        );
        displayGuides(filteredGuides);
    }

    // Filter guides by category
    function filterByCategory(category) {
        if (category === 'all') {
            displayGuides(firstAidGuides);
            return;
        }
        
        const filteredGuides = firstAidGuides.filter(guide => 
            guide.category === category
        );
        displayGuides(filteredGuides);
    }

    // Display guides in the accordion
    function displayGuides(guidesToDisplay) {
        guidesAccordion.innerHTML = '';

        if (guidesToDisplay.length === 0) {
            guidesAccordion.innerHTML = '<div class="guide-item"><div class="guide-header"><h4>No guides found matching your search</h4></div></div>';
            return;
        }

        guidesToDisplay.forEach(guide => {
            const guideItem = document.createElement('div');
            guideItem.className = 'guide-item';
            guideItem.innerHTML = `
                <div class="guide-header">
                    <h4>${guide.title}</h4>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div class="guide-content">
                    ${guide.content}
                </div>
            `;
            guidesAccordion.appendChild(guideItem);

            // Add click event to toggle accordion
            const header = guideItem.querySelector('.guide-header');
            header.addEventListener('click', function() {
                // Close all other open accordion items
                document.querySelectorAll('.guide-item.active').forEach(openItem => {
                    if (openItem !== guideItem) {
                        openItem.classList.remove('active');
                    }
                });
                
                // Toggle current item
                guideItem.classList.toggle('active');
                
                // Rotate chevron icon
                const icon = header.querySelector('i');
                icon.classList.toggle('fa-chevron-down');
                icon.classList.toggle('fa-chevron-up');
            });
        });
    }

    // Reset search and show all guides
    function resetSearch() {
        searchInput.value = '';
        displayGuides(firstAidGuides);
    }

    // Event listeners
    searchInput.addEventListener('input', filterGuides);
    searchButton.addEventListener('click', filterGuides);
    
    if (resetButton) {
        resetButton.addEventListener('click', resetSearch);
    }
    
    categoryCards.forEach(card => {
        card.addEventListener('click', function() {
            const category = this.getAttribute('data-category');
            filterByCategory(category);
        });
    });

    // Close accordion when clicking outside
    document.addEventListener('click', function(event) {
        if (!event.target.closest('.guide-header') && !event.target.closest('.guide-content')) {
            document.querySelectorAll('.guide-item').forEach(item => {
                item.classList.remove('active');
                item.querySelector('.guide-header i').classList.remove('fa-chevron-up');
                item.querySelector('.guide-header i').classList.add('fa-chevron-down');
            });
        }
    });

    // Initialize with all guides
    displayGuides(firstAidGuides);
});












document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    
    hamburger.addEventListener('click', function() {
        this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
        navLinks.classList.toggle('active');
    });
    
    // Mobile dropdown functionality
    const dropdownToggles = document.querySelectorAll('.dropdown-toggle');
    
    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            if (window.innerWidth <= 992) {
                e.preventDefault();
                const dropdown = this.closest('.dropdown');
                dropdown.classList.toggle('active');
            }
        });
    });
});