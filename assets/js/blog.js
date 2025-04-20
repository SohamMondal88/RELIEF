document.addEventListener('DOMContentLoaded', function() {
    // Mobile Menu Toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const mobileMenu = document.querySelector('.mobile-menu');
    
    mobileMenuBtn.addEventListener('click', function() {
        mobileMenu.classList.toggle('active');
    });
    
    // Close mobile menu when clicking on a link
    const mobileLinks = document.querySelectorAll('.mobile-menu a');
    mobileLinks.forEach(link => {
        link.addEventListener('click', function() {
            mobileMenu.classList.remove('active');
        });
    });
    
    // Navbar scroll effect
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Health Alert Slider Navigation
    const alertSlider = document.querySelector('.alert-slider');
    if (alertSlider) {
        let isDown = false;
        let startX;
        let scrollLeft;
        
        alertSlider.addEventListener('mousedown', (e) => {
            isDown = true;
            startX = e.pageX - alertSlider.offsetLeft;
            scrollLeft = alertSlider.scrollLeft;
        });
        
        alertSlider.addEventListener('mouseleave', () => {
            isDown = false;
        });
        
        alertSlider.addEventListener('mouseup', () => {
            isDown = false;
        });
        
        alertSlider.addEventListener('mousemove', (e) => {
            if(!isDown) return;
            e.preventDefault();
            const x = e.pageX - alertSlider.offsetLeft;
            const walk = (x - startX) * 2;
            alertSlider.scrollLeft = scrollLeft - walk;
        });
    }
    
    // News Filter Buttons
    const filterButtons = document.querySelectorAll('.header-actions .btn-outline');
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Here you would typically filter news items
            // For demo purposes, we'll just log the filter
            console.log(`Filtering by: ${this.textContent}`);
        });
    });
    
    // Newsletter Form Submission
    const newsletterForm = document.querySelector('.newsletter-form');
    if (newsletterForm) {
        const newsletterInput = newsletterForm.querySelector('input');
        const newsletterButton = newsletterForm.querySelector('button');
        
        newsletterButton.addEventListener('click', function(e) {
            e.preventDefault();
            
            if (!newsletterInput.value || !newsletterInput.value.includes('@')) {
                alert('Please enter a valid email address');
                return;
            }
            
            // Here you would typically send the email to your server
            alert(`Thank you for subscribing with ${newsletterInput.value}!`);
            newsletterInput.value = '';
        });
    }
    
    // Search Functionality
    const searchBar = document.querySelector('.search-bar');
    if (searchBar) {
        const searchInput = searchBar.querySelector('input');
        const searchButton = searchBar.querySelector('button');
        
        searchButton.addEventListener('click', function() {
            if (searchInput.value.trim() === '') {
                alert('Please enter a search term');
                return;
            }
            
            // Here you would typically perform the search
            console.log(`Searching for: ${searchInput.value}`);
            alert(`Searching for: ${searchInput.value}`);
        });
        
        // Allow search on Enter key
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchButton.click();
            }
        });
    }
    
    // Article Card Hover Effects for Touch Devices
    const articleCards = document.querySelectorAll('.article-card, .topic-card, .news-card');
    articleCards.forEach(card => {
        card.addEventListener('touchstart', function() {
            this.classList.add('hover-effect');
        });
        
        card.addEventListener('touchend', function() {
            this.classList.remove('hover-effect');
        });
    });
    
    // Initialize animations when elements come into view
    const animateOnScroll = function() {
        const elements = document.querySelectorAll('.alert-card, .article-card, .topic-card, .news-card');
        
        elements.forEach(element => {
            const elementPosition = element.getBoundingClientRect().top;
            const screenPosition = window.innerHeight / 1.2;
            
            if (elementPosition < screenPosition) {
                element.classList.add('animate');
            }
        });
    };
    
    window.addEventListener('scroll', animateOnScroll);
    animateOnScroll(); // Run once on load
});