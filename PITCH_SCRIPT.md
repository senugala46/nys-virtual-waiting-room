# Pitch Script — NYS Virtual Waiting Room (VWR)

**Format:** ~5-minute hackathon pitch + live demo. Speaker notes in plain prose; stage
directions in *[brackets]*. Timings are a guide.

---

## 0. Hook *(0:00–0:30)*

> "Imagine you're a New Yorker who filed an appeal because your Medicaid benefits were cut.
> Your hearing is virtual. You log in… and you're staring at a generic video 'waiting room'
> with no idea if your interpreter showed up, whether the judge is ready, or if you're even in
> the right place. Meanwhile the Administrative Law Judge has no list of who's present, and a
> supervisor managing 60 hearings a day is flying blind.
>
> That's the gap we closed. We built the **New York State Virtual Waiting Room** — the missing
> layer between scheduling a fair hearing and actually holding it."

*[Have the login screen up on the projector.]*

---

## 1. The Problem *(0:30–1:10)*

> "NYS ITS runs virtual fair hearings for three agencies — OTDA, DOH, and OCFS — on Cisco
> WebEx. WebEx gives you a 'waiting room' and a 'meeting room,' but it can't do the things a
> *hearing* actually needs:
>
> - It can't track **presence** — who has checked in, and who is ready.
> - It can't enforce that a hearing only starts when **all required parties**, including the
>   judge, are available.
> - It gives the judge **no roster**, the supervisor **no oversight dashboard**, and nobody an
>   **audit trail**.
>
> So today this is managed with phone calls, spreadsheets, and guesswork. Our solution turns
> that chaos into a structured, real-time, role-aware workflow."

---

## 2. What We Built *(1:10–1:40)*

> "A complete, working web application with two halves:
>
> 1. **The Virtual Waiting Room** — role-based check-in, live presence and readiness tracking,
>    judge call controls, a supervisor oversight dashboard, reporting, and a full audit log.
> 2. **In-house video conferencing** — a peer-to-peer WebRTC hearing room we built ourselves,
>    so NYS isn't dependent on a third-party meeting vendor.
>
> It's built entirely on the **official New York State Design System**, it's 508/WCAG
> accessible, and it runs with zero external dependencies — no database, no cloud, no API keys."

---

## 3. Live Demo *(1:40–3:40)* — the heart of the pitch

*[Have 4–5 browser tabs pre-opened to localhost:3000. Keep narration tight.]*

**Step 1 — Roles & SSO** *(tab 1)*
> "Everyone signs in through what would be ITS Identity single sign-on. Your role — appellant,
> representative, interpreter, judge, supervisor — determines exactly what you see."

**Step 2 — Check-in builds presence** *(tabs 1–4)*
> "I'll sign in as the appellant, her representative, the Spanish interpreter, and the agency
> rep. Each checks in and marks themselves Available. Watch the hearing status climb in real
> time: **Not Checked In → Not Ready → …**"

**Step 3 — The readiness gate** *(judge tab)*
> "Now the judge — ALJ Burns. Notice her **Call Hearing** button is locked, and it tells her
> exactly who she's waiting on. The moment the last required party — including the judge
> herself — is available, the hearing flips to **Ready** and Call unlocks. A hearing can never
> start with a missing party. That's the core rule, enforced by the system, not by a phone call."

**Step 4 — Call, then join our own video room**
> "She calls the hearing, starts it, and everyone clicks **Join Virtual Hearing** — and we're
> in a live video call we built ourselves. Mute, camera, **screen share** to show evidence,
> in-hearing **chat**, and **judge-only controls** to mute or remove a participant, plus a
> recording indicator. No WebEx required."

**Step 5 — Oversight** *(supervisor tab)*
> "And the supervisor sees *everything* — every hearing for the day, live statuses, who's
> checked in, which judges are currently in session — searchable and sortable. Down here is the
> live **audit log** and operational metrics: every action is recorded for compliance."

*[Hit the Reset button if you need a clean slate.]*

---

## 4. How It Works *(3:40–4:10)*

> "Architecture is deliberately simple and robust: a Node/Express server with Socket.io pushes
> a live state snapshot to every browser on every change — that's why all those tabs update
> instantly. The video is **WebRTC peer-to-peer**, with our server acting only as the
> signaling broker. The whole thing is one process, no database — seeded from what would be the
> IES system of record, with clearly marked integration seams for IAM, IES, and conferencing."

*[Optionally show the architecture slide.]*

---

## 5. AI Involvement *(4:10–4:40)*

> "Two parts. **First, how we built it:** this entire application — backend, real-time engine,
> WebRTC video, and the NYS-Design-System UI — was built with an **AI coding agent** in hours,
> not weeks. We've even packaged a single reusable build prompt so any team can regenerate it.
>
> **Second, AI is now in the product — not just on a slide.** We built four AI features:
> **live captions and transcription** in the hearing; **real-time translation assist** so an
> interpreter sees captions in their language; **automated hearing summaries** drafted for the
> judge from the transcript; and **predictive wait-times** so supervisors can rebalance the
> docket. The captions run in the browser; translation and summaries call a hosted model when an
> API key is configured and fall back to a working offline mode otherwise; wait-times are a live
> heuristic. From here it's about production-grade accuracy and legal-record handling."

*[If demoing AI live: turn on Captions in the conference (Chrome), pick a language for the
interpreter translation, then click Generate Summary on the judge's card; show the supervisor's
Est. wait column.]*

---

## 5b. Impact — Who This Really Helps *(brief; weave into demo or close)*

> "Let me be concrete about who this is for — because it's not a generic productivity tool,
> it touches real New Yorkers at a vulnerable moment."

- **Appellants & their families** — vulnerable New Yorkers appealing decisions about Medicaid,
  SNAP, child care, and temporary assistance. They get clarity instead of anxiety, no wasted
  trips, guaranteed interpreter presence, **the entire interface in their native language (the
  NYS 12-language set + English, including right-to-left scripts)**, and a 508-accessible
  process. *This is access to justice.*
- **Representatives & advocates (legal aid)** — see readiness in real time, manage multiple
  hearings at once, and stop losing days to adjournments caused by a missing party.
- **Hearing Officers (ALJs)** — finally get a live roster and a readiness gate, focus on one
  hearing at a time, and start on time instead of sitting idle in a blank room.
- **Supervisors & clerks** — day-wide oversight to rebalance dockets, plus live metrics and a
  full audit trail for compliance.
- **Agencies (OTDA / DOH / OCFS) & ITS** — in-house video means no vendor lock-in, a complete
  audit record, and clean integration with IES and ITS IAM.
- **New York State & taxpayers** — higher throughput, fewer no-shows and adjournments, and
  lower third-party conferencing cost.

> "Bottom line: better outcomes for the New Yorker on the other side of the screen, and a real
> tool for the people who serve them."

---

## 5c. Future Plans / Roadmap *(brief; mention 2–3, leave rest on the slide)*

> "This is a working demo today — here's how it becomes a production NYS system."

**Phase 1 — Productionize & Integrate**
- Wire up real ITS IAM SSO (SAML2 / OIDC), live IES read + write-back, and scheduling/calendar
  sync. Add a database for persistence.

**Phase 2 — Scale & Record**
- Add a TURN server (cross-network reliability) and an SFU for large hearings; server-side
  recording to NYS storage; high-availability deployment; load & performance testing.

**Phase 3 — AI-Augment (prototype delivered)**
- Live captions/transcription, interpreter translation assist, automated hearing summaries, and
  predictive wait-times are **built**. Next: production-grade accuracy, hosting, and legal-record
  handling for AI output.

**Phase 4 — Expand & Optimize**
- SMS/email notifications to appellants, native mobile apps, multilingual UI, analytics &
  docket optimization, and rollout to additional NYS hearing types beyond OTDA/DOH/OCFS.

**Cross-cutting (every phase):** security & compliance (immutable/WORM audit, encryption at
rest, retention policies, recording consent, penetration testing), WCAG 2.2 AA accessibility,
and 24/7 operational monitoring.

---

## 6. Why It Matters / Close *(4:40–5:00)*

> "This is about access to justice. Faster, fairer, more transparent hearings for New Yorkers
> appealing decisions about their benefits — and a real tool for the staff who run them. We
> built a working system, on NYS standards, that's ready to integrate.
>
> **The New York State Virtual Waiting Room. Thank you — happy to take questions.**"

---

## Q&A — likely questions & crisp answers

- **"Is the video really yours, or WebEx?"** Ours — WebRTC mesh, our Socket.io server only
  does signaling. No third-party meeting service.
- **"Does it scale?"** The waiting room scales easily. Mesh video suits hearing-sized rooms
  (≤ ~8); for larger we'd add a TURN server and an SFU — a known, standard path.
- **"Security / compliance?"** Role-based access, an immutable-style audit log, and SSO via
  ITS IAM (SAML2/OIDC). PII stays within NYS-hosted infrastructure.
- **"Is the AI live today?"** The AI *built* the app; the in-product AI features
  (transcription, translation, summaries) are roadmap items the architecture is designed for.
- **"How long did this take?"** Built as a working demo during the hackathon using an AI
  coding agent, on the official NYS Design System.

---

## One-liner (for the program / elevator)

> *A real-time, role-aware Virtual Waiting Room for New York State fair hearings — with its own
> built-in video conferencing — that tracks presence, enforces readiness, and gives judges and
> supervisors the oversight WebEx can't.*
