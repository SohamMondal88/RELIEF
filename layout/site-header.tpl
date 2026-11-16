<nav class="navbar" aria-label="Main navigation">
    <div class="container">
        <div class="navbar-left">
            <ul class="nav-links" id="main-nav-links">
                <li><a href="{{root}}index.html" data-i18n="nav.home">Home</a></li>
                <li><a href="{{root}}pages/about.html" data-i18n="nav.about">About Us</a></li>
                <li><a href="{{root}}pages/contact.html" data-i18n="nav.contact">Contact</a></li>
                <li class="dropdown"><a href="#" class="dropdown-toggle" aria-expanded="false"><span data-i18n="nav.services">Services</span> <i class="fas fa-chevron-down" aria-hidden="true"></i></a>
                    <ul class="dropdown-menu">
                        <li><a href="{{root}}pages/doctors.html" data-i18n="nav.doctors">Doctors</a></li>
                        <li><a href="{{root}}pages/symptoms.html" data-i18n="nav.symptoms">Symptom-checker</a></li>
                        <li><a href="{{root}}pages/hospitals.html" data-i18n="nav.hospitals">Hospitals</a></li>
                        <li><a href="{{root}}pages/pharmacies.html" data-i18n="nav.pharmacies">Pharmacies</a></li>
                        <li><a href="{{root}}pages/health-events.html">Health camps &amp; events</a></li>
                        <li><a href="{{root}}pages/ambulances.html" data-i18n="nav.ambulances">Ambulances</a></li>
                    </ul>
                </li>
            </ul>
        </div>

        <div class="navbar-center">
            <div class="logo">
                <img src="{{root}}assets/images/logo.jpg" alt="Relief Logo">
            </div>
        </div>

        <div class="navbar-right">
            <ul class="nav-links">
                <li><a href="{{root}}pages/ambulances.html" class="nav-emergency" data-i18n="nav.emergency">Emergency</a></li>
{{if:tour}}
                <li><button type="button" class="btn-tour-nav" id="btn-revisit-tour" aria-label="Take a guided tour of RELIEF"><i class="fas fa-compass" aria-hidden="true"></i> <span data-i18n="nav.tour">Tour</span></button></li>
{{endif}}
                <li><a href="{{root}}pages/login.html" class="btn-login" data-i18n="nav.login">Login</a></li>
                <li><a href="{{root}}pages/signup.html" class="btn-signup" data-i18n="nav.signup">Sign Up</a></li>
            </ul>

            <button type="button" class="hamburger" aria-label="Mobile menu" data-i18n-attr="aria-label:nav.menu" aria-expanded="false" aria-controls="main-nav-links">
                <span></span>
                <span></span>
                <span></span>
            </button>
        </div>
    </div>
</nav>
