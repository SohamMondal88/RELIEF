# RELIEF HackaTropia 2026 Transformation Blueprint

## 1) Full Website Audit

### 1.1 Product and UX Audit (Current State)
- **Navigation is feature-first but journey-light**: pages exist, but there is no clearly prioritized emergency path (e.g., "I need help now" in one tap).
- **Primary user journeys are disconnected**: symptom checking, provider discovery, and booking feel like parallel modules rather than a single care funnel.
- **Trust cues are under-leveraged**: compliance badges and healthcare branding exist, but legal disclaimers and consent checkpoints are not surfaced at high-risk interaction points.
- **No explicit low-literacy mode**: copy density and decision complexity can be high for stressed users.
- **Limited status feedback**: users can enter ambiguous states (e.g., appointment intent without confirmed booking lifecycle).

### 1.2 Logic and Edge-Case Audit
- **LocalStorage-only persistence risks stale/incorrect medical context** after tab/device changes.
- **No robust online/offline state modeling** beyond static-page resilience.
- **Emergency fallbacks are not strongly modeled** (e.g., no queueing strategy if SMS/API unavailable).
- **Role assumptions are implicit**: user vs provider/admin permissions are not formalized.
- **Data validation and auditability gaps**: no server-side guarantees for booking integrity, medical history consistency, or misuse detection.

### 1.3 Security, Scalability, and Performance Gaps
- **Security gap**: static frontend + LocalStorage lacks secure auth, token lifecycle, encryption-at-rest controls, and server-enforced authorization.
- **Scalability gap**: no backend event model for reminders, alerts, geospatial indexing, or concurrent booking requests.
- **Performance gap**: static assets are workable for demos but need budgeted loading, caching strategy, and core web vitals monitoring.
- **Compliance gap**: no explicit policy-to-implementation mapping for PHI/PII handling.

### 1.4 Production-Grade Alternative to LocalStorage
Use a **hybrid cloud + offline cache architecture**:
- **Primary datastore**: Supabase Postgres (or Firebase Firestore) for user data, bookings, providers, reminders.
- **Auth**: Supabase Auth / Firebase Auth with email + OTP.
- **Offline cache**: IndexedDB + service worker sync queue (for symptom drafts, SOS intents, reminder acknowledgments).
- **Real-time**: Supabase Realtime or Firestore listeners for booking/ambulance state.
- **Messaging**: Twilio/MSG91 for SMS fallback, FCM for push.

---

## 2) Required Pages and Why They Are Essential

## 2.1 Sitemap (Hackathon-Ready)
1. **Landing / Home**
2. **Symptom Checker**
3. **Doctors Directory**
4. **Hospitals & Pharmacies Map**
5. **Ambulance & Emergency (SOS)**
6. **First Aid Knowledge Hub**
7. **User Dashboard**
8. **About RELIEF**
9. **How It Works (Judge View)**
10. **Privacy Policy**
11. **Terms + Medical Disclaimer**
12. **Contact & Feedback**
13. **Admin/Doctor Panel** (optional but highly scored)

### 2.2 Page Purpose and Core UX Requirements
- **Landing / Home**: anchors problem-solution-impact story for judges, donors, and first-time users.
- **Symptom Checker**: triage intake with explainable output, urgency grading, and disclaimer before actions.
- **Doctors Directory**: discover and book care; includes filters (specialty, language, distance, teleconsult availability).
- **Hospitals & Pharmacies Map**: geospatial decision support (open now, stock hints, ETA).
- **Ambulance & Emergency**: single-screen SOS-first design (call, share location, notify caregivers, first-aid prompts).
- **First Aid Hub**: structured emergency guidance for pre-hospital intervention.
- **User Dashboard**: longitudinal context (history, reminders, alerts, booked visits, emergency contacts).
- **About RELIEF**: mission credibility and rural healthcare impact framing.
- **How It Works**: transparent architecture and operational flow for hackathon juries.
- **Privacy Policy**: trust + legal baseline, especially around medical data handling.
- **Terms + Medical Disclaimer**: sets non-diagnostic boundaries and user responsibilities.
- **Contact & Feedback**: support loop and product-learning pipeline.
- **Admin/Doctor Panel**: demonstrates operational viability (provider onboarding, triage queues, response metrics).

---

## 3) Feature Expansion (Practical + Demoable)

### 3.1 AI/NLP Symptom Checker (Explainable Hybrid)
- **Input**: free text + structured prompts (age range, duration, severity, red-flag signs).
- **Engine**:
  - Layer A: rule-based red-flag triage (deterministic, safety-first).
  - Layer B: LLM-assisted intent normalization and symptom clustering.
  - Layer C: recommendation policy (self-care / consult doctor / emergency).
- **Output**:
  - urgency score,
  - possible condition clusters (non-diagnostic wording),
  - next-best action,
  - confidence explanation ("based on fever + chest pain + duration").

### 3.2 Emergency SOS Stack
- One-tap SOS with haptic/visual confirmation.
- Live location sharing with emergency contacts + nearest service lookup.
- SMS fallback payload when internet drops: "SOS|name|lat,long|timestamp|condition".
- Offline mode queues request and retries when network returns.
- "Stress Mode" UI: high contrast, huge buttons, minimal text.

### 3.3 Care Continuity Features
- Appointment workflow (request → confirm → reminder → check-in).
- Medication reminders with dose schedule and acknowledgement logging.
- Health history timeline (symptoms, visits, medicines, alerts).
- Push/SMS notifications for reminders, appointment changes, escalations.
- Role-based access:
  - **User**: personal records + booking + SOS.
  - **Doctor**: assigned patient summaries + availability + follow-up notes.
  - **Admin**: provider verification + system analytics + moderation.

### 3.4 What to Demo vs What to Mock
**Demo live**:
- Symptom intake and urgency classification,
- provider discovery + booking state transition,
- SOS flow with map + fallback simulation,
- multilingual switch,
- reminder notification (simulated push).

**Mock transparently**:
- real ambulance dispatch integration,
- EHR interoperability,
- pharmacy inventory APIs in regions without open datasets,
- insurance/payment clearing.

---

## 4) Tech Stack Upgrade (Hackathon-Friendly)

### 4.1 Recommended Architecture
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui.
- **Backend**: Supabase (Postgres, Auth, Realtime, Edge Functions).
- **Alt stack**: Firebase (Auth + Firestore + Functions) if team is Firebase-native.
- **Maps/Geo**: Leaflet retained for familiarity + OpenStreetMap + optional Mapbox geocoding.
- **Notifications**: FCM + Twilio/MSG91 SMS fallback.
- **Observability**: Sentry + lightweight analytics (PostHog/Plausible).

### 4.2 AI Integration Strategy
- **Hybrid model** (safety + practicality):
  - rules for emergency red flags,
  - LLM for language understanding and multilingual paraphrasing,
  - fixed policy layer for final recommendation class.
- Maintain audit logs for prompts/responses (de-identified where possible).

### 4.3 Privacy and Security Baseline
- JWT/session auth with refresh rotation.
- Row-level security (RLS) for per-user medical data.
- Encryption in transit (TLS) and encrypted storage.
- Consent logging for sharing location/medical context.
- Minimal retention policy + export/delete account controls.
- Clear emergency-use disclaimer and non-diagnostic label everywhere applicable.

---

## 5) UX and Accessibility Standards

### 5.1 Mobile-First Emergency UX
- Sticky bottom emergency actions on all relevant pages.
- Single-thumb operation for SOS.
- Fast startup path: app open → SOS in <2 taps.

### 5.2 Inclusive Interaction Design
- 48px+ touch targets.
- Multi-language toggles in global header and emergency screen.
- Plain-language copy + icon support for low literacy.
- Voice-assisted readout (future-friendly but mockable in hackathon).

### 5.3 WCAG Basics to Enforce
- Minimum 4.5:1 text contrast.
- Visible focus indicators and keyboard navigability.
- Semantic headings and landmarks.
- ARIA labels on icon-only emergency controls.

### 5.4 Medical Safety UX
- Prominent, repeated disclaimers: "Not a medical diagnosis. In emergencies call local services immediately."
- Red-flag symptoms always override regular booking flow and route to emergency guidance.

---

## 6) Hackathon Polish

### 6.1 3–4 Minute Demo Flow
1. **Problem framing (20s)**: rural care delays, triage ambiguity, emergency access barriers.
2. **Symptom to action (70s)**: user enters symptoms → receives urgency + next steps.
3. **Care access (60s)**: map + doctor search → booking confirmation.
4. **Emergency proof (50s)**: SOS pressed → location share + SMS fallback simulation.
5. **Continuity (30s)**: dashboard timeline + reminders + multilingual switch.
6. **Credibility close (20s)**: privacy model + roadmap.

### 6.2 Judge-Focused Highlights
- Safety-first triage with explainable output.
- Rural-first design: low bandwidth, multilingual, fallback channels.
- End-to-end continuum: symptom → provider → emergency → follow-up.
- Feasible architecture with clear post-hackathon path.

### 6.3 Impact Metrics (Estimated, Not Fabricated)
- Potential reduction in time-to-first-guidance from hours to minutes.
- Increased appointment conversion due to integrated discovery + booking.
- Improved emergency response initiation in low-connectivity settings via SMS fallback.
- Higher medication adherence through reminder loop.

### 6.4 Post-Hackathon Roadmap
- **Phase 1 (0–2 months)**: production auth, database migration, hardened SOS workflows.
- **Phase 2 (2–4 months)**: pilot with local clinics, provider onboarding, multilingual expansion.
- **Phase 3 (4–8 months)**: partner integrations (ambulance, pharmacy stock APIs), analytics-driven triage refinement.

### 6.5 One-Liner Pitch
**RELIEF is an AI-assisted, emergency-first healthcare access platform that turns symptom uncertainty into safe action in minutes—especially for underserved communities.**

### 6.6 Why RELIEF Should Win
- Tackles a high-severity, real-world healthcare gap.
- Balances innovation with deployable, hackathon-feasible engineering.
- Demonstrates measurable social impact with a practical implementation path.

---

## 7) Transformation Backlog (Execution Order)

### Week-0 Hackathon Build Order
1. Re-platform core UI to componentized frontend (or clean modular JS if no migration time).
2. Implement auth + role scaffolding.
3. Build symptom triage hybrid engine with disclaimers.
4. Build directory/map + booking lifecycle.
5. Implement SOS flow with offline queue and SMS fallback simulation.
6. Add dashboard timeline + reminders.
7. Finalize policy pages, accessibility pass, and demo instrumentation.

### Acceptance Criteria (Demo-Ready)
- All core flows complete without dead ends.
- Emergency path accessible from all major screens.
- Role-based data separation demonstrable.
- Multilingual switch works in at least two languages.
- Disclaimers visible in symptom and emergency contexts.
