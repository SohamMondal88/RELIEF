#!/usr/bin/env bash
set -euo pipefail

TARGETS=(
  assets/css/professional-pages.css
  assets/js/app-enhancements.js
  assets/js/dashboard.js
  assets/js/login.js
  assets/js/signup.js
  index.html
  pages/about.html
  pages/admin-panel.html
  pages/ambulances.html
  pages/appointments.html
  pages/blog.html
  pages/careers.html
  pages/contact.html
  pages/cookie-policy.html
  pages/dashboard.html
  pages/doctors.html
  pages/donate.html
  pages/firstaid.html
  pages/home.html
  pages/hospitals.html
  pages/how-it-works.html
  pages/login.html
  pages/pharmacies.html
  pages/press.html
  pages/privacy-policy.html
)

echo "Checking merge conflict markers in listed files..."
rg -n '^(<<<<<<<|=======|>>>>>>>)' "${TARGETS[@]}" && {
  echo "Conflict markers detected." >&2
  exit 1
}

echo "No merge conflict markers found in listed files."
