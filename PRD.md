# Product Requirements Document — NYS Virtual Waiting Room (VWR)

| | |
|---|---|
| **Product** | NYS Virtual Waiting Room (VWR) + In-house Conferencing |
| **Owner** | NYS ITS (Integrated Eligibility System / Fair Hearings) |
| **Agencies served** | OTDA, DOH, OCFS |
| **Status** | Prototype / hackathon demo (working) → candidate for productization |
| **Document version** | 1.0 |

> **Legend used throughout:**
> **Priority** — M (Must) · S (Should) · C (Could).
> **Status** — ✅ Implemented (demo) · ◑ Partial · ◯ Proposed/roadmap.

---

## 1. Overview

The Virtual Waiting Room (VWR) is a web application that manages **attendance, presence,
readiness, and flow** for Parties of Interest (POIs) in New York State virtual fair hearings,
and then conducts the hearing over **in-house video conferencing**. It fills the gap left by
Cisco WebEx/CMR, which provides a generic waiting room and meeting room but cannot track
*presence* or enforce *readiness*, and gives judges and supervisors no oversight.

A virtual hearing has two parts: **(1) Attendance & Waiting** and **(2) the hearing itself**.
The VWR owns part 1 end to end and provides part 2 via integrated peer-to-peer video.

---

## 2. Problem statement

- WebEx's waiting room cannot record **presence** — who has checked in and who is ready.
- Nothing enforces that a hearing only begins when the required parties (including the ALJ) are
  ready, so hearings stall on missing participants.
- Administrative Law Judges (ALJs) have no roster; supervisors have no real-time oversight of a
  day's docket; there is no consolidated audit trail.
- Today these gaps are bridged by phone calls, spreadsheets, and manual coordination — causing
  delays, no-shows, and inconsistent records, which directly affects New Yorkers appealing
  decisions about Medicaid, SNAP, child care, and temporary assistance.

---

## 3. Goals & non-goals

### Goals
- Provide a single, real-time, **role-aware** view of every hearing's participants and readiness.
- Enforce a clear **status lifecycle** and give the ALJ controls to run the waiting room.
- Give supervisors **oversight** across the full daily docket.
- Provide **NYS-hosted conferencing** so virtual hearings don't depend on a third-party vendor.
- Meet **NYS branding** and **508/WCAG accessibility** standards.
- Integrate cleanly with **ITS IAM** (SSO) and **IES** (hearing data) via open standards.

### Non-goals
- Scheduling/assigning ALJs to hearings (upstream of this product; out of scope).
- Case management, decision drafting, or the substantive adjudication record.
- Replacing IES as the system of record.

---

## 4. Personas & roles

The system supports 9 roles with role-specific permissions and visibility:

| Role | Primary needs |
|---|---|
| **Appellant** | Check into hearing(s), confirm availability, see who else is present, join the hearing. |
| **Appellant Representative** | Same as appellant; often manages multiple hearings. |
| **Appellant Witness** | Check in, confirm availability, join when called; limited view of others. |
| **Agency Representative** | Check in across hearings, confirm availability, view participants. |
| **Agency Witness** | Check in, join when called; limited view. |
| **Interpreter** | See assigned hearings, confirm availability, join when called; limited view. |
| **Hearing Officer (ALJ)** | See assigned hearings, manage readiness, call/start/close/recall, manage participants, record. |
| **Administrative Staff (Clerk)** | Day-wide oversight, search, view attendees and statuses. |
| **Supervisor** | Day-wide oversight, monitor officers in session, search/sort, recordings. |

---

## 5. Scope

**In scope:** authentication/SSO seam, role-based access, check-in & presence, status lifecycle,
ALJ controls, supervisor oversight, search/sort/filter, in-house conferencing, recording,
reporting, audit log, IES/IAM integration seams.

**Out of scope (this release):** real production SSO/IES integrations, database persistence,
server-side recording at scale, scheduling, and the security accreditation required for
production (tracked in §12/§13).

---

## 6. Assumptions & dependencies

- **A1.** Authentication is federated through **ITS IAM** (SAML2 / OAuth / OIDC); the VWR
  consumes role and identity claims. *(Currently mocked.)*
- **A2.** Hearing and participant data originate in **IES** and flow in both directions.
- **A3.** ALJ assignment to hearings happens **outside** the VWR and is provided as input.
- **A4.** Users access the app via a modern web browser on desktop, tablet, or phone.
- **A5.** Production conferencing will require TURN/SFU infrastructure and NYS-hosted storage.

---

## 7. Functional requirements

### 7.1 Authentication & access control
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-AUTH-1 | Authenticate via ITS IAM SSO (SAML2 / OAuth / OIDC); accept role + identity claims. | M | ◑ (mock `/api/login`) |
| FR-AUTH-2 | Derive the user's permissions and visible data from their role. | M | ✅ |
| FR-AUTH-3 | Enforce authorization server-side on every action. | M | ◯ (client-side today) |
| FR-AUTH-4 | Support single sign-on and session handling. | M | ◯ |

### 7.2 Roles & permissions
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-ROLE-1 | Provide differentiated functionality/visibility for all 9 roles. | M | ✅ |
| FR-ROLE-2 | Interpreters and witnesses have a **limited view** (cannot see full participant details of others). | M | ✅ |
| FR-ROLE-3 | Restrict the ALJ to **one active hearing at a time**. | M | ✅ |

### 7.3 Check-in, presence & status lifecycle
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-WR-1 | Parties can check into **multiple** hearings and view the list of hearings they've joined. | M | ✅ |
| FR-WR-2 | Participants can set availability (**Available / Unavailable**) and check out. | M | ✅ |
| FR-WR-3 | Track each participant's **check-in time** and status. | M | ✅ |
| FR-WR-4 | Maintain a waiting-room **status lifecycle**: `not_checked_in → not_ready → ready → called → recalled → closed`. | M | ✅ |
| FR-WR-5 | A hearing is **Ready** (Call enabled) per the readiness rule. *Production rule:* all required parties (incl. ALJ) ready. *Demo rule:* at least one participant checked in & available. | M | ✅ (demo rule; configurable) |
| FR-WR-6 | `called` / `recalled` / `closed` are officer-controlled and not auto-recomputed. | M | ✅ |
| FR-WR-7 | Participants view the statuses of other participants by role (subject to FR-ROLE-2). | S | ✅ |

### 7.4 Hearing Officer (ALJ) controls
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-ALJ-1 | View hearings assigned to the officer; check in and set own availability. | M | ✅ |
| FR-ALJ-2 | **Call** (and **Recall**) a hearing from the waiting room. | M | ✅ |
| FR-ALJ-3 | **Accept (call)** or **deny/remove** a participant. | M | ✅ |
| FR-ALJ-4 | **Start** the hearing (launch conferencing). | M | ✅ |
| FR-ALJ-5 | **Reassign** a hearing to another officer. | S | ✅ |
| FR-ALJ-6 | **Close** the hearing/waiting room with a disposition; **recall** a closed hearing. | M | ✅ |
| FR-ALJ-7 | Manage the waiting room while conducting a hearing. | S | ✅ |

### 7.5 Supervisor / Administrative oversight
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-SUP-1 | View all hearings scheduled for the day; sort by specific data. | M | ✅ |
| FR-SUP-2 | View statuses, attendees, and checked-in counts per hearing. | M | ✅ |
| FR-SUP-3 | See which officers are currently in a hearing. | M | ✅ |
| FR-SUP-4 | Search waiting rooms by hearing attributes (officer, category of aid, type, agency, status, etc.). | M | ✅ |
| FR-SUP-5 | Browse and play/download saved hearing recordings. | S | ✅ |

### 7.6 Search, sort & filter
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-SRCH-1 | Search hearings by predefined criteria (number, name, type, agency, category of aid). | M | ✅ |
| FR-SRCH-2 | Order/sort hearings by custom criteria (time, appellant name, status, agency). | M | ✅ |
| FR-SRCH-3 | Filter by status. | S | ✅ |

### 7.7 Conferencing (in-house video)
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-CONF-1 | Provide NYS-hosted peer-to-peer video/audio for the hearing (replacing WebEx/CMR). | M | ✅ (WebRTC mesh) |
| FR-CONF-2 | Controls: mute, camera on/off, screen share, in-hearing chat, leave. | M | ✅ |
| FR-CONF-3 | Host (ALJ) controls: mute or remove a participant; live roster. | M | ✅ |
| FR-CONF-4 | Scale to larger rooms via TURN + SFU. | S | ◯ |

### 7.8 Recording
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-REC-1 | Capture a recording of the hearing and persist it server-side. | M | ◑ (host-side capture + upload) |
| FR-REC-2 | List, play back, and download saved recordings (supervisor). | S | ✅ |
| FR-REC-3 | Authoritative server-side recording independent of any client browser. | M | ◯ (SFU-based, roadmap) |
| FR-REC-4 | Recording consent capture and retention controls. | M | ◯ |

### 7.9 Reporting & audit
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-RPT-1 | Provide operational data and metrics from the VWR (counts by status, check-ins, by agency). | M | ✅ |
| FR-AUD-1 | Record an audit trail of meaningful actions (login, check-in/out, availability, call, deny, start, reassign, close, recall, conference join/leave, host actions, recording saved). | M | ✅ |
| FR-AUD-2 | Adhere to NYS/IES auditing requirements (immutable/WORM, retention). | M | ◯ |

### 7.10 Integrations
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-INT-1 | Integrate with ITS IAM for AuthN/AuthZ/SSO. | M | ◑ (seam) |
| FR-INT-2 | Integrate bidirectionally with IES for hearing/participant data. | M | ◑ (seam: `seedData`/`pushToIES`) |
| FR-INT-3 | Receive up-to-date information from IES. | M | ◯ |
| FR-INT-4 | Output information back to IES (status, assigned officer, participants). | M | ◑ (seam) |
| FR-INT-5 | Use open, secure standards (REST/web services, OIDC/SAML). | M | ✅ (pattern) |

### 7.11 AI assistance
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-AI-1 | **Live captions / transcription** during the hearing; accumulate a transcript. | S | ✅ (browser Web Speech API; Chrome/Edge) |
| FR-AI-2 | **Real-time translation assist** for interpreters (translate live captions to a chosen language). | S | ✅ (live with `ANTHROPIC_API_KEY`; demo fallback otherwise) |
| FR-AI-3 | **Automated hearing summaries** for the judge, generated from the transcript. | S | ✅ (live with `ANTHROPIC_API_KEY`; extractive fallback otherwise) |
| FR-AI-4 | **Predictive wait-times** per hearing + docket-balancing suggestions. | S | ✅ (heuristic; no key needed) |
| FR-AI-5 | Production-grade STT/MT/LLM hosting, accuracy tuning, and the legal-record handling AI output requires. | S | ◯ |

---

## 8. Non-functional requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| NFR-UI-1 | UI aligned to NYS IES branding/themes (NYS Design System). | M | ✅ |
| NFR-UI-2 | Responsive for multi-device use (desktop/tablet/phone). | M | ✅ |
| NFR-LANG-1 | Multilingual UI for the NYS language-access set (12 languages + English), incl. RTL; appellant can view the interface in their native language. | M | ✅ (English + Spanish baked; other 11 via translation service w/ English fallback) |
| NFR-A11Y-1 | ADA / Section 508 / WCAG 2.1–2.2 AA compliance, tested with assistive tech. | M | ◑ (built with a11y components; full audit pending) |
| NFR-PERF-1 | Real-time updates reflected to all participants near-instantly. | M | ✅ (state broadcast) |
| NFR-SCALE-1 | Horizontal scaling for peak docket load (Socket.io clustering/Redis; SFU for video). | M | ◯ |
| NFR-REL-1 | Reconnection, state resync, graceful degradation, zero-downtime deploys. | M | ◯ |
| NFR-SEC-1 | Encryption in transit and at rest; secrets management; server-enforced authz. | M | ◯ |
| NFR-SEC-2 | Security accreditation (NIST 800-53 / StateRAMP-style controls, pen testing, ATO). | M | ◯ |
| NFR-PRIV-1 | PII handling, data minimization, DOH health-data sensitivity, breach procedures. | M | ◯ |
| NFR-DATA-1 | Durable persistence with backups and disaster recovery (replace in-memory store). | M | ◯ |
| NFR-BROW-1 | Support current Chrome/Edge/Firefox; secure context (HTTPS) for media APIs. | M | ✅ (localhost demo); ◯ (HTTPS prod) |

---

## 9. Key user flows

1. **Appellant journey:** SSO login → see my hearing(s) → Check In → set Available → wait → see
   the hearing turn Ready and the ALJ call it → Join Virtual Hearing → participate → hearing closed.
2. **ALJ journey:** SSO login → see assigned hearings → check in/Available → monitor readiness →
   Call → Start (launch video) → conduct hearing (mute/remove as needed, record) → Close with a
   disposition → optionally Recall.
3. **Supervisor journey:** SSO login → oversight dashboard of the day's docket → search/sort →
   see officers in session and live statuses → review audit log/metrics → review recordings.

---

## 10. Data model (core entities)

- **Hearing:** id, hearingNumber, hearingType, categoryOfAid, agency, date, scheduledTime,
  appellantName, assignedOfficerId, status, disposition, conferenceUrl, participants[].
- **Participant:** userId, name, role, required, checkedIn, checkInTime, status
  (available/unavailable), denied.
- **User (directory/IAM):** userId, name, role.
- **Audit event:** id, timestamp, actor, action, detail.
- **Recording:** file, bytes, savedAt, url (linked to a hearing).

---

## 11. Success metrics (KPIs)

- **Reduced hearing start delay** (time from scheduled to actual start).
- **Reduced no-shows and adjournments** attributable to coordination/presence gaps.
- **Time-to-ready** (check-in to Ready) trend.
- **Supervisor coverage** (hearings observable in real time vs. total).
- **Audit completeness** (% of actions captured) and **recording capture rate**.
- **Accessibility conformance** (WCAG AA pass rate) and **user satisfaction** (staff + POIs).

---

## 12. Release plan / roadmap

- **Phase 0 — Prototype (done):** full workflow + in-house video + recording demo on NYSDS.
- **Phase 1 — Productionize & integrate:** real ITS IAM SSO, live IES read/write, scheduling
  sync, database persistence, server-enforced authorization.
- **Phase 2 — Scale & record:** TURN + SFU, server-side recording to NYS storage, HA, load testing.
- **Phase 3 — AI hardening:** the four AI features (live captions/transcription, interpreter
  translation assist, hearing summaries, predictive wait-times — FR-AI-1…4) are **built** and
  listed under delivered features (§7.11). This phase covers only the remaining production work
  (FR-AI-5): production-grade STT/MT/LLM hosting, accuracy tuning & evaluation, legal-record
  handling for AI output, and professional language-access translations.
- **Phase 4 — Expand & optimize:** notifications (SMS/email), mobile apps, multilingual UI,
  analytics/docket optimization, additional hearing types.
- **Cross-cutting (all phases):** security & compliance, WCAG 2.2 AA, 24/7 operations.

---

## 13. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Identity mismatch between IAM users and IES participants | Users see no hearings | Define IAM↔IES identity mapping; key participants by federated subject. |
| Mesh video doesn't scale to large hearings | Quality/availability | Adopt TURN + SFU in Phase 2. |
| Host-side recording loss (browser-dependent) | Incomplete legal record | Server-side SFU recording (FR-REC-3). |
| Compliance/accreditation effort underestimated | Launch delay | Plan ATO and security work in parallel from Phase 1. |
| In-memory store / no persistence | Data loss | Introduce database + backups (NFR-DATA-1) early in Phase 1. |
| Accessibility gaps beyond component defaults | 508 non-compliance | Full WCAG audit + assistive-tech testing. |

---

## 14. Open questions

- Exact readiness policy in production (strict "all required parties" vs. configurable per agency)?
- Recording retention schedule, consent flow, and who may access recordings?
- Source of role claims (IAM groups vs. IES vs. a VWR-specific mapping)?
- TURN/SFU and storage hosting decisions within NYS infrastructure?

---

## 15. Glossary

- **VWR** — Virtual Waiting Room. **POI** — Party of Interest. **ALJ** — Administrative Law
  Judge (Hearing Officer). **IES** — Integrated Eligibility System. **ITS IAM** — NYS Identity &
  Access Management. **CMR** — Cisco Collaborative Meeting Room. **SFU** — Selective Forwarding
  Unit (video). **TURN** — relay for NAT traversal. **Category of Aid** — benefit program type.
