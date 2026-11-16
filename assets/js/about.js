
function reliefPrefersReducedMotion() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
document.addEventListener('DOMContentLoaded', function() {
    // Animate stats counter
    function animateStats() {
        const statItems = document.querySelectorAll('.stat-item');

        statItems.forEach(item => {
            const numberElement = item.querySelector('.stat-number');
            const target = parseInt(numberElement.getAttribute('data-count'));
            const suffix = item.querySelector('.stat-label').textContent.includes('%') ? '%' : '';
            if (reliefPrefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
                numberElement.textContent = target + suffix;
                return;
            }
            const duration = 2000; // Animation duration in ms
            const startTime = performance.now();

            function updateNumber(currentTime) {
                const elapsedTime = currentTime - startTime;
                const progress = reliefPrefersReducedMotion() ? 1 : Math.min(elapsedTime / duration, 1);
                const currentNumber = Math.floor(progress * target);

                numberElement.textContent = currentNumber + suffix;

                if (progress < 1) {
                    requestAnimationFrame(updateNumber);
                }
            }

            // Start animation when element is in viewport
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    requestAnimationFrame(updateNumber);
                    observer.unobserve(item);
                }
            });

            observer.observe(item);
        });
    }

    // Team member hover effect for mobile
    function initTeamMemberHover() {
        const teamMembers = document.querySelectorAll('.team-member');

        teamMembers.forEach(member => {
            member.addEventListener('click', function() {
                if (window.innerWidth <= 992) {
                    this.classList.toggle('active');
                }
            });
        });
    }

    // Smooth scrolling for anchor links
    function initSmoothScrolling() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                e.preventDefault();

                const targetId = this.getAttribute('href');
                if (targetId === '#') return;

                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    window.scrollTo({
                        top: targetElement.offsetTop - 80,
                        behavior: reliefPrefersReducedMotion() ? 'instant' : 'smooth'
                    });
                }
            });
        });
    }

    // Initialize functions
    animateStats();
    initTeamMemberHover();
    initSmoothScrolling();

    // Add animation to timeline items when they come into view
    const timelineItems = document.querySelectorAll('.timeline-item');

    const timelineObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
            }
        });
    }, { threshold: 0.1 });

    timelineItems.forEach(item => {
        if (reliefPrefersReducedMotion() || !timelineObserver) item.classList.add('animate');
        else timelineObserver.observe(item);
    });

    // Add animation to value cards when they come into view
    const valueCards = document.querySelectorAll('.value-card');

    const valueObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
            }
        });
    }, { threshold: 0.1 });

    valueCards.forEach(card => {
        if (reliefPrefersReducedMotion() || !valueObserver) card.classList.add('animate');
        else valueObserver.observe(card);
    });
});
