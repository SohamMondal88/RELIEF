<footer class="footer" aria-label="Footer">
    <div class="container">
        <div class="footer-grid">
            <div class="footer-section about">
                <h3 data-i18n="footer.about.title">About Relief</h3>
                <p data-i18n="footer.about.text">Relief is a comprehensive healthcare solution designed to provide immediate medical assistance and information to everyone, everywhere.</p>

                <div class="social-links">
                    <a href="#" aria-label="Facebook"><i class="fab fa-facebook-f"></i></a>
                    <a href="#" aria-label="Twitter"><i class="fab fa-twitter"></i></a>
                    <a href="#" aria-label="Instagram"><i class="fab fa-instagram"></i></a>
                    <a href="#" aria-label="LinkedIn"><i class="fab fa-linkedin-in"></i></a>
                </div>
            </div>

            <div class="footer-section links">
                <h3 data-i18n="footer.links.title">Quick Links</h3>
                <ul>
                    <li><a href="{{root}}index.html" data-i18n="footer.home">Home</a></li>
                    <li><a href="{{root}}pages/symptoms.html" data-i18n="footer.symptoms">Symptom Checker</a></li>
                    <li><a href="{{root}}pages/doctors.html" data-i18n="footer.doctors">Find Doctors</a></li>
                    <li><a href="{{root}}pages/hospitals.html" data-i18n="footer.hospitals">Find Hospitals</a></li>
                    <li><a href="{{root}}pages/pharmacies.html" data-i18n="footer.pharmacies">Find Pharmacies</a></li>
                    <li><a href="{{root}}pages/health-events.html">Health Camps &amp; Events</a></li>
                    <li><a href="{{root}}pages/ambulances.html" data-i18n="footer.emergency">Emergency Services</a></li>
{{if:tour}}
                    <li><button type="button" class="footer-tour-link" id="footer-revisit-tour" data-i18n="footer.tour"><i class="fas fa-compass" aria-hidden="true"></i> Quick Tour &amp; Guide</button></li>
{{endif}}
                </ul>
            </div>

            <div class="footer-section links">
                <h3 data-i18n="footer.company.title">Company</h3>
                <ul>
                    <li><a href="{{root}}pages/about.html" data-i18n="footer.about">About Us</a></li>
                    <li><a href="{{root}}pages/team.html" data-i18n="footer.team">Our Team</a></li>
                    <li><a href="{{root}}pages/careers.html" data-i18n="footer.careers">Careers</a></li>
                    <li><a href="{{root}}pages/blog.html" data-i18n="footer.blog">Blog</a></li>
                    <li><a href="{{root}}pages/press.html" data-i18n="footer.press">Press</a></li>
                    <li><a href="{{root}}pages/contact.html" data-i18n="footer.contact">Contact</a></li>
                </ul>
            </div>

            <div class="footer-section contact">
                <h3 data-i18n="footer.contact.title">Contact Us</h3>
                <ul class="contact-info">
                    <li><i class="fas fa-map-marker-alt"></i> 123 Healthcare Ave, Medical City, MC 12345</li>
                    <li><i class="fas fa-phone"></i> <a href="tel:+18005551234">+1 (800) 555-1234</a></li>
                    <li><i class="fas fa-envelope"></i> <a href="mailto:support@relief.com">support@relief.com</a></li>
                    <li><i class="fas fa-clock"></i> <span data-i18n="footer.support">24/7 Support Available</span></li>
                </ul>
            </div>
        </div>

        <div class="footer-bottom">
            <div class="footer-legal">
                <p>&copy; 2026 Relief. <span data-i18n="footer.rights">All rights reserved.</span></p>
                <div class="legal-links">
                    <a href="{{root}}pages/privacy-policy.html" data-i18n="footer.privacy">Privacy Policy</a>
                    <a href="{{root}}pages/accessibility.html">Accessibility</a>
                    <a href="{{root}}pages/terms-of-service.html" data-i18n="footer.terms">Terms of Service</a>
                    <a href="{{root}}pages/cookie-policy.html" data-i18n="footer.cookies">Cookie Policy</a>
                </div>
            </div>

            <div class="footer-badges">
                <img src="{{root}}assets/images/hipaa-badge.webp" alt="HIPAA Compliant" width="80" height="40">
                <img src="{{root}}assets/images/ssl-badge.jpg" alt="SSL Secured" width="80" height="40">
            </div>
        </div>
    </div>
</footer>
