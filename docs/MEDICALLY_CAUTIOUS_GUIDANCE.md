# Medically Cautious Symptom-Information Guidance

## 1. Overview and Clinical Scope

This document defines the clinical safety principles, tracked medical references, escalation logic, and pre-production clinical review requirements for the **Symptom Information Flow** in RELIEF (GitHub Issue #20).

### Core Principles
1. **Educational and Navigational, Not Diagnostic:** RELIEF provides general health information to assist users in understanding care options. It does not provide medical diagnoses, clinical predictions, or definitive conclusions.
2. **Safety-First Priority:** Potential emergency warning signs take absolute precedence over routine information or self-care guidance.
3. **Explicit Uncertainty:** The application clearly communicates that symptoms have multiple possible causes and that digital tools cannot replace an in-person evaluation by a qualified medical professional.
4. **No Prescription or Treatment Alterations:** The application never recommends initiating, discontinuing, or adjusting dosages of prescription medications.
5. **Safe Handling of Incomplete Inputs:** Skipped questions, partial responses, or ambiguous inputs are handled gracefully without inventing symptoms, assuming safety, or providing false reassurance.

---

## 2. Tracked Medical References and Review Dates

The safety guidance and emergency warning-sign screening in RELIEF are derived from public health guidance issued by recognized, authoritative medical organizations.

| Organization / Publisher | Guidance Title | Official URL | Date Reviewed (Technical) | Date Last Updated by Source | Technical Verification Status | Clinical Validation Status |
|---|---|---|---|---|---|---|
| **Centers for Disease Control and Prevention (CDC)** | *When to Seek Emergency Medical Attention & Respiratory Illness Symptoms* | [cdc.gov/respiratory-viruses/symptoms](https://www.cdc.gov/respiratory-viruses/symptoms/index.html) | 2026-10-18 | 2024-03-01 | Verified | Pending Clinician Review |
| **Centers for Disease Control and Prevention (CDC)** | *Signs and Symptoms of Stroke (FAST)* | [cdc.gov/stroke/signs-symptoms](https://www.cdc.gov/stroke/signs-symptoms/index.html) | 2026-10-18 | 2024-05-15 | Verified | Pending Clinician Review |
| **National Health Service (NHS, UK)** | *When to call 999: Life-threatening emergencies* | [nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-call-999](https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-call-999/) | 2026-10-18 | 2024-01-15 | Verified | Pending Clinician Review |
| **World Health Organization (WHO)** | *Clinical Emergency Care and Severe Illness Warning Signs* | [who.int/emergency-care](https://www.who.int/teams/integrated-health-services/clinical-services-and-systems/emergency-care) | 2026-10-18 | 2023-11-20 | Verified | Pending Clinician Review |
| **American Heart Association (AHA)** | *Warning Signs of a Heart Attack* | [heart.org/.../warning-signs-of-a-heart-attack](https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack) | 2026-10-18 | 2023-08-10 | Verified | Pending Clinician Review |

*Review Definitions and Status Notes:*
- **Date Reviewed (Technical):** The calendar date (2026-10-18) on which project developers inspected the publisher's official public page, verified domain ownership and URL validity, and confirmed text alignment with the documented safety claims.
- **Technical Verification Status (Verified):** Denotes that the source link exists, belongs to the stated publisher domain, and is currently active and reachable.
- **Clinical Validation Status (Pending Clinician Review):** Explicitly indicates that technical inspection does NOT constitute formal clinical validation or medical board endorsement. Production deployment remains conditional upon formal institutional clinician review (Section 5).

---

## 3. Emergency Warning Signs and Escalation Logic

### 3.1 Warning Signs Catalog & Variation Coverage
The following red-flag scenarios are treated as potential medical emergencies:
- **Severe chest pain, pressure, fullness, squeezing, or tightness** (possible acute coronary syndrome / cardiac event). Covers phrasing variations like "pain in my chest", "pressure in chest", "chest tightness".
- **Severe shortness of breath, gasping, or inability to breathe** (possible severe respiratory distress or failure). Covers variations like "trouble breathing", "unable to breathe", "can't catch breath", "choking", "blue lips".
- **Signs of stroke (FAST):** sudden facial droop, one-sided arm/leg weakness or numbness, slurred speech or inability to speak. Covers variations like "slurring words", "slurring my speech", "loss of speech".
- **Seizures and convulsions:** uncontrolled shaking, epileptic fit, or post-seizure confusion.
- **Sudden, unusually severe headache** (e.g. "worst headache of your life" / potential subarachnoid hemorrhage) or acute sudden confusion.
- **Uncontrolled bleeding, or coughing/vomiting blood.**
- **Loss of consciousness, fainting, collapse, or inability to awaken.** Covers variations like "blacked out", "passed out", "unresponsive".
- **Severe allergic reaction (anaphylaxis):** acute swelling of face, lips, tongue, or throat, or airway constriction.

### 3.2 Negation and Contextual Phrasing Handling
To prevent false-alarm escalations while preserving high-sensitivity safety:
1. **Negation Detection:** Free-text descriptions are screened for negation prefixes (`no`, `not`, `without`, `denies`, `negative for`, `never`, `free of`). For example, "mild cough, no chest pain" does not trigger a false chest pain alarm.
2. **Clause and Conjunction Boundaries:** If a contrastive conjunction or punctuation boundary (`but`, `however`, `,`, `.`, `;`) occurs between the negation word and the symptom (e.g., "no fever, but severe chest pain"), the negation scope is terminated, ensuring the true emergency indicator is promptly detected.
3. **Keyword Matching Limitation:** Keyword screening is inherently heuristic. The system explicitly discloses that automated keyword detection cannot rule out emergencies, and users experiencing severe or rapidly deteriorating symptoms are directed to seek emergency services regardless of keyword match results.

### 3.3 Escalation Protocol
1. **Immediate Detection:** Red flags are checked via structured options in Step 1 and real-time keyword analysis on user text.
2. **Immediate Alert:** If an emergency symptom is detected, an immediate alert banner is presented on screen with direct regional emergency calling options (112, 911, 999, and local services). The user is not required to complete further questions.
3. **Emergency Precedence in Results:** In the results view, the **Emergency Guidance Banner** appears at the very top. Routine care suggestions and self-care tips are suppressed so they cannot distract or delay urgent care.
4. **Multi-Region Emergency Routing:** Directs users to contact their local emergency service without assuming a single country (such as 112 in India/EU/GSM, 911 in US/Canada, 999 in UK, or local services) or visit the nearest emergency department. No geolocation or personal tracking is performed.
5. **Non-Exhaustiveness Statement:** The application explicitly warns that the warning signs list is **not exhaustive**, and the absence of listed signs does **not** guarantee safety. Users who feel severely unwell or worsen rapidly are directed to seek urgent care immediately.

---

## 4. Communication of Uncertainty and Clinical Guardrails

### 4.1 Non-Diagnostic Presentation
- The application never presents a confirmed disease diagnosis (e.g., it does not state "You have Tension Headache" or provide a percentage probability such as "Probability: 85%").
- Information is framed as **"Educational Health Topics to Discuss with Your Doctor"**.
- The user is reminded that many distinct health conditions share overlapping symptoms, and only an in-person physical examination, clinical history, and diagnostic testing can establish a diagnosis.

### 4.2 Prescription Medication Guardrails
- The system never recommends initiating, discontinuing, or changing prescription medications.
- The system never suggests medication dosage amounts or schedules.
- Explicit warnings advise users to consult their prescribing physician or a licensed pharmacist before taking or changing any medications.

### 4.3 Incomplete and Ambiguous Inputs
- If a user provides incomplete inputs (e.g. skips duration or severity), the system does not crash or block the user with intrusive alerts.
- Missing fields are recorded and presented as **"Incomplete Responses Noted"**, highlighting that clinical uncertainty is increased.
- If user input is empty, ambiguous, or unparseable, the system communicates high uncertainty, refrains from falsely assuring the user, and reminds them that lack of reported symptoms is not proof of safety.

### 4.4 Medicine Reminders (Dashboard)
- Reminders are a convenience tool. They only repeat the medicine name, note, time and dates that the user typed in. RELIEF does not suggest medicines, doses or schedules, and the form says so.
- Reminders are stored in the browser's `localStorage` (key `relief_reminders_v1`) on one device. They are not synced to an account, not a medical record, and are lost if the user clears site data or switches browser or device.
- Times are the device's local clock time. A reminder only fires while the dashboard is open in a tab; there is no background or server-side delivery, so it must not be relied on for time-critical medication.
- If the device time zone changes, reminders follow the new local clock time and the reminder card shows the zone it was created in.
- Browser notifications are explained before the permission prompt and only requested when the user presses the button. If permission is denied or unsupported, due reminders still appear in an in-app banner.
- Logic lives in `assets/js/reminders.js` and is covered by `tests/reminders.test.js` (run with `node --test`).

---

## 5. Clinical Review Requirements Prior to Production Use

Before deploying this symptom guidance feature in a production environment:

1. **Qualified Clinical Professional Review:**
   - A licensed healthcare professional (such as a medical doctor or clinical triage specialist) must review the symptom intake questions, red-flag categories, and response copy.
2. **Escalation Logic Validation:**
   - The red-flag trigger rules, keyword matching patterns, and triage escalations must undergo clinical testing and validation across diverse demographic and clinical test cases.
   - Emergency contact numbers and dispatch routing must be verified for the specific jurisdiction where the software is deployed.
3. **Reference Maintenance Protocol:**
   - Medical guidance references must be reviewed at least once every six months to verify that URLs, guidelines, and public-health recommendations remain current.
4. **No Claim of Clinical Validation:**
   - Until formal, documented institutional clinical validation has been completed, this feature **must not** be marketed, certified, or described as a clinically approved or validated medical diagnostic tool.
