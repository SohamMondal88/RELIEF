# RELIEF Contributor Setup and Deployment Guide

This guide explains how to obtain the RELIEF source code, preview the website locally, understand its current integrations, and prepare a deployment. RELIEF is primarily a frontend HTML, CSS, and JavaScript project.

> **Important:** RELIEF is an informational and educational project. Do not rely on it for diagnosis, treatment, emergency dispatch, or other time-critical medical services. The repository contains demonstration behavior and placeholder integration settings; not every feature is necessarily operational.

## 1. Prerequisites

Install or have access to:

- [Git](https://git-scm.com/downloads)
- [Visual Studio Code](https://code.visualstudio.com/) or another code editor
- A current web browser
- An internet connection for external resources and integrations

The repository does not currently define a root `package.json`, so a Node.js/npm installation is not required for the basic static preview described below.

## 2. Fork and clone the repository

1. Open the [RELIEF repository](https://github.com/SohamMondal88/RELIEF).
2. Select **Fork** on GitHub to create a copy under your account.
3. In a terminal, replace `YOUR_USERNAME` with your GitHub username:

```bash
git clone https://github.com/YOUR_USERNAME/RELIEF.git
cd RELIEF
```

If you have already cloned your fork, change into that existing `RELIEF` directory instead of cloning it again.

To check the configured remotes:

```bash
git remote -v
```

If you need to add the original repository as `upstream` and that remote is not already configured:

```bash
git remote add upstream https://github.com/SohamMondal88/RELIEF.git
git remote -v
```

Do not add the same remote twice. If `upstream` already exists, keep the existing entry.

## 3. Understand the project structure

The following is a high-level map of the current repository. It is not an exhaustive file listing.

| Path | Purpose |
|---|---|
| `index.html` | Main entry page for the static website |
| `pages/` | Additional website pages, such as doctors, hospitals, appointments, login, and first aid |
| `assets/css/` | Shared and page-specific stylesheets |
| `assets/js/` | Client-side behavior and integration code |
| `assets/images/` | Images and visual assets |
| `profiles/` | Doctor, patient, ambulance, and pharmacy profile interfaces |
| `docs/` | Project and contributor documentation |
| `.github/` | GitHub repository configuration |
| `README.md` | Project overview and getting-started information |
| `LICENSE` | Project license |

When changing a page, inspect its HTML and the CSS and JavaScript files it references. Keep changes focused on the assigned issue.

### Key files and their responsibilities

- **Entry and Pages (`index.html`, `pages/`)**:
  - `index.html`: Main landing page providing core value proposition, emergency callout, feature cards, and quick navigation.
  - `pages/symptoms.html`: Multi-step interactive symptom checker with client-side form validation and triage guidance.
  - `pages/doctors.html`, `pages/hospitals.html`, `pages/pharmacies.html`, `pages/ambulances.html`: Directory pages for healthcare provider discovery, hospital locations, pharmacy contacts, and emergency ambulance services.
  - `pages/appointments.html`: Patient appointment booking request workflow.
  - `pages/firstaid.html`: Educational first-aid instructions and pre-hospital emergency guidance.
  - `pages/login.html` & `pages/signup.html`: Demonstration authentication forms.
  - `pages/dashboard.html`: User dashboard displaying localized records, reminders, and health timelines.
- **Stylesheets (`assets/css/`)**:
  - `style.css`: Primary global design system, typography, color scheme, navbar, buttons, layout grids, and core media queries.
  - Page-specific stylesheets (`auth.css`, `doctors.css`, `hospitals.css`, `symptoms.css`, `dashboard.css`, etc.): Specialized UI rules and section layouts for individual feature pages.
- **Client-Side Scripts (`assets/js/`)**:
  - `main.js`: Global site behaviors (mobile navigation toggle, smooth scrolling, and alerts).
  - `api.js`: Centralized client-side API layer managing endpoints (OpenStreetMap/Nominatim, OpenMRS, Rasa) and Firebase SDK wrappers.
  - `firebase-config.js`: Initializes the Firebase web client using configured project parameters.
  - `symptoms.js`: Multi-step questionnaire navigation, client-side input validation, and fallback mock symptom analysis.
  - `dashboard.js`: Manages user appointments and reminder state persisted in browser `localStorage`.
  - `contact.js`: Contact page form handling and dynamic Google Maps script loading.

## 4. Preview the website locally

### Option A: Open the entry page

For a basic static preview, open `index.html` in your browser.

### Option B: Use VS Code Live Server

1. Open the `RELIEF` folder in VS Code.
2. Install the **Live Server** extension if it is not already installed.
3. Open `index.html`.
4. Select **Open with Live Server**.

A local web server is often more reliable than opening files directly, particularly for pages that load scripts or resources using browser features that restrict `file://` URLs.

There is no repository-defined automated test command in the current root setup. Test relevant pages and flows manually in the browser, and check the browser developer console for errors.

## 5. Configuration and external services

The current code references several external integrations. A static preview can load without all of them, but features that depend on these services may fail or show demonstration behavior.

| Integration or setting | What contributors should know |
|---|---|
| Firebase | `assets/js/api.js` and `assets/js/firebase-config.js` contain placeholder configuration values. Real project configuration is required for Firebase-backed authentication and Firestore operations. |
| OpenStreetMap / Nominatim | Location searches make requests to Nominatim. Results depend on network access, service availability, and the service's usage policy. |
| Rasa | The chatbot configuration points to `http://localhost:5005`. A compatible Rasa service must be running locally for that endpoint to respond. |
| Symptom analysis | `assets/js/symptoms.js` references an external symptom-analysis API. Verify its current endpoint, access requirements, and configuration before relying on it. |
| Google Maps | `assets/js/contact.js` contains a `YOUR_API_KEY` placeholder in a Google Maps script URL. A valid, appropriately restricted key may be required for that map feature. |
| Browser storage | Some demonstration flows use `localStorage`, which is specific to the browser profile and device and is not a secure, shared medical-record store. |

### Safe configuration practices

- Never commit passwords, private tokens, service-account files, or real secrets.
- Do not replace placeholders with personal credentials in a public pull request.
- Follow the relevant provider's official setup instructions and the project's maintainer guidance before configuring a service.
- Browser-side Firebase web configuration is not equivalent to server-side secret storage. Production use requires appropriate Firebase security rules, access controls, and a security review.
- Do not assume a configured endpoint is valid just because it appears in source code. Confirm that the provider supports the endpoint and request format used by the application.

### Environment configuration and browser security

RELIEF is currently an entirely client-side static web application. It runs directly in the browser and does not have a Node.js runtime, build step (such as Vite or Webpack), or server process:

- **No runtime `.env` support:** Browsers cannot read `.env` files or `process.env`. The application does not load or process environment variables.
- **Browser-side configuration:** All service configurations and API endpoints are loaded directly in client-side JavaScript files (`assets/js/api.js`, `assets/js/firebase-config.js`, `assets/js/contact.js`, and `assets/js/symptoms.js`).
- **Client exposure risk:** Any value included in frontend JavaScript files or loaded via the browser DOM is publicly visible to anyone inspecting network requests or page source. **Never place private keys, database administrative credentials, secret tokens, or payment gateway secrets in frontend code.**
- **Existing in-code placeholders:** The repository intentionally uses dummy placeholders for development demonstration:
  - `assets/js/firebase-config.js` and `assets/js/api.js`: `apiKey: "your_api_key"`, `projectId: "your_project"`, etc.
  - `assets/js/contact.js`: `key=YOUR_API_KEY`
  - `assets/js/symptoms.js`: `YOUR_INFERMEDICA_APP_ID`, `YOUR_INFERMEDICA_APP_KEY` (with automatic fallback to local mock results)
- **Do not commit `.env` or `.env.example`:** Because the static site does not use environment variables, do not add an `.env` or `.env.example` file to the repository. If the project architecture is later upgraded with a build tool or backend service that introduces environment-variable injection, configuration should then be documented with safe placeholder names (e.g., `FIREBASE_API_KEY=your_placeholder_key`) without exposing secrets.

## 6. Demo behavior versus production

Treat the repository as a frontend project with demonstration flows unless a feature has been verified against its real service.

- Browser `localStorage` data stays in that browser's local storage and may be cleared by the user or browser.
- Placeholder Firebase values will not connect the project to a real Firebase application.
- The Rasa URL requires a compatible local service.
- A successful UI interaction does not prove that an external provider, healthcare professional, pharmacy, ambulance, or emergency service received a request.
- Do not describe symptom guidance as a medical diagnosis or claim clinical validation without evidence.

Do not use the demo for real patient records or real emergency response.

## 7. Make a contribution

Before starting, read the issue and obtain maintainer assignment or permission as required by the repository's contribution process.

Create a separate branch from an up-to-date base branch. For example:

```bash
git fetch upstream
git checkout -b docs/describe-your-change upstream/main
```

Replace `docs/describe-your-change` with a short, relevant branch name. If your repository uses a different default branch, use the branch specified by the maintainers.

After making changes, inspect and validate them:

```bash
git status
git diff --check
git diff
```

Test the affected page or behavior in a browser. Include the checks you actually performed in the pull request; do not claim tests that you did not run.

Commit and push your branch:

```bash
git add docs/CONTRIBUTING_SETUP.md README.md
git commit -m "docs: add contributor setup guide"
git push -u origin docs/describe-your-change
```

Adjust the `git add` paths to match the files you changed. Open a pull request from your fork's branch into the original repository's target branch, describe the changes, mention the issue number, and provide relevant verification details.

## 8. Deployment overview

The README identifies [Vercel](https://vercel.com/) as the live demonstration and deployment platform. The exact production deployment settings are not fully specified by the repository files covered by this guide, so confirm the project's current Vercel configuration and deployment process with the maintainers before changing production settings.

For a static deployment:

1. Confirm that the site works locally and that asset paths resolve correctly.
2. Check the target host's build and output settings against the repository's actual structure.
3. Configure any required external integrations separately and securely.
4. Test the deployed pages and any integration-dependent flows.
5. Confirm that the deployment is a demonstration unless the required services, security controls, and operational workflows have been implemented and reviewed.

Do not add an invented build command or assume that all integrations work in production.

## 9. Troubleshooting

| Problem | What to check |
|---|---|
| A page looks unstyled | Confirm the CSS path in the page's `<link>` elements and use the repository root as the expected folder structure. |
| JavaScript does not run | Open browser developer tools and check the Console for syntax errors and the Network panel for missing files. |
| A feature works on one page but not another | Check whether that page loads the required JavaScript files and whether relative asset paths are correct. |
| A map or search shows no results | Check internet access, browser console/network errors, request parameters, and the external service's availability and usage requirements. |
| Firebase login or data operations fail | Confirm that valid Firebase configuration is provided through the maintainer-approved setup and that the relevant Authentication and Firestore services and rules are configured. |
| Chatbot requests fail | Confirm that a compatible Rasa service is running at the configured URL and that the endpoint is reachable from the browser. |
| A feature works only after opening with Live Server | Continue using a local HTTP server for testing and check for browser restrictions affecting direct `file://` access. |
| A page works locally but not after deployment | Check deployed asset paths, hosting configuration, browser console errors, and any integration-specific origin or access restrictions. |

## 10. Before opening a pull request

- [ ] I worked on an issue assigned to me or received maintainer permission.
- [ ] The guide describes the current repository rather than hypothetical features.
- [ ] I did not add real credentials or secrets.
- [ ] I checked the links, commands, and Markdown formatting.
- [ ] I tested the relevant steps or clearly stated what I could not test.
- [x] The README links to this guide.
- [ ] The pull request describes the change and the checks performed.

## Related links

- [RELIEF repository](https://github.com/SohamMondal88/RELIEF)
- [Open issues](https://github.com/SohamMondal88/RELIEF/issues)
- [Vercel documentation](https://vercel.com/docs)
- [Firebase documentation](https://firebase.google.com/docs)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
