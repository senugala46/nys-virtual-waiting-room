# Presentation Q&A Prep — NYS Virtual Waiting Room (VWR)

Use this to rehearse. Answers are written to be spoken in 15–30 seconds. The golden rule:
**be honest about what's built (demo) vs. what's roadmap.** Judges respect "that's the next
step" far more than overclaiming.

---

## 0. Your safety net — generic responses when you DON'T know

Pick whichever fits; deliver calmly, don't bluff:

1. **Defer to discovery (best default):**
   *"Great question — that's exactly the kind of detail we'd lock down in the design/discovery
   phase with ITS and the agencies. My instinct is [X], but I'd confirm against the requirements
   rather than guess on the spot."*

2. **Scope honesty:**
   *"We deliberately scoped this hackathon build to prove the workflow and the in-house video.
   That specific piece is on the production roadmap — happy to follow up with specifics."*

3. **Take it back (for hard technical/policy specifics):**
   *"I don't want to give you a wrong answer on that. Let me take it back, confirm, and get you a
   precise response."*

4. **Architecture-supports-it:**
   *"The architecture was designed to support that; the exact implementation depends on NYS
   infrastructure and policy decisions, so I'd validate before committing to an approach."*

5. **Redirect to strength:**
   *"I'm not certain on that detail — what I can speak to confidently is [the thing you DO know],
   and we'd treat that as a follow-up."*

> Tip: it's fine to say "I don't know" once or twice. Confidence + honesty beats a wrong answer.

---

## 1. Product & scope

**Q: What problem does this actually solve?**
WebEx gives a generic waiting room but can't track *presence* or *readiness*, gives judges no
roster and supervisors no oversight. Today that's run by phone calls and spreadsheets. We close
that gap with a real-time, role-aware waiting room.

**Q: Who are the users?**
Nine roles — appellants, representatives, witnesses, agency reps, interpreters, hearing officers
(ALJs), administrative staff, and supervisors — each with role-specific views and permissions.

**Q: Is this replacing WebEx entirely?**
The waiting room is net-new. The video is our own in-house WebRTC, so yes — it can replace
WebEx/CMR for the hearing itself, which means no third-party meeting vendor.

**Q: What's in scope vs. out of scope?**
In: attendance, presence, readiness, the hearing itself, recording, evidence, requests,
reporting, audit. Out (intentionally): scheduling/assigning judges, case management, and the
substantive decision record — those stay in IES.

**Q: How long did this take to build?**
Built as a working demo during the hackathon using an AI coding agent — hours, not weeks — on the
official NYS Design System.

---

## 2. Technical / architecture

**Q: What's the tech stack?**
Node.js + Express + Socket.io on the backend; vanilla HTML/CSS/JS frontend on the NYS Design
System; WebRTC for video. Deliberately dependency-light — runs with `npm install && npm start`.

**Q: How does the real-time sync work?**
Every action mutates server state, then the server broadcasts a full state snapshot over
Socket.io to all clients, which re-render. That's why every tab updates instantly.

**Q: Is the video really yours, or WebEx under the hood?**
Ours — WebRTC peer-to-peer. Our server only does signaling (exchanging connection info); the
audio/video flows directly between participants. No third-party meeting service.

**Q: Does the peer-to-peer (mesh) video scale?**
For hearing-sized rooms (≤ ~8) it's fine. For production we'd move to an **SFU** (selective
forwarding unit) + **TURN** servers — that's the standard path and it's on the roadmap (Phase 2).
The signaling we built is largely reusable.

**Q: Why mesh if it doesn't scale?**
It's the right call for a prototype — zero infrastructure, fast to prove the concept. Production
swaps the media layer for an SFU; the app/workflow logic doesn't change.

**Q: Where's the data stored?**
In-memory for the demo (resets on restart) — no database needed to show the workflow. Production
would use a real database (e.g., PostgreSQL) with backups and HA. Recordings/evidence are the
only things written to disk.

---

## 3. Security, privacy & compliance (the heavy ones)

**Q: Is it secure / production-ready?**
The *architecture* is sound and the workflow is proven, but this exact build is a prototype.
Production needs the full security program: encryption in transit and at rest, server-enforced
authorization, secrets management, pen testing, and an ATO. We've scoped that as explicit work,
not an afterthought.

**Q: How is authentication handled?**
Today it's a mock SSO. Production federates to **ITS IAM** for staff (SAML2/OIDC) and likely
**NY.gov ID** for the public (appellants). Our `/api/login` is the single seam where real SSO
plugs in.

**Q: Is authorization enforced?**
Right now role checks are client-side for the demo. In production every action must be enforced
**server-side** — that's a known, required hardening step.

**Q: This handles PII and health data — how do you protect it?**
Correct, and that raises the bar: PII handling, DOH health-data sensitivity, encryption,
retention, breach procedures, and accreditation (NIST 800-53 / StateRAMP-style controls). It's
the bulk of the production effort and we'd plan it from day one.

**Q: Are recordings a legal record? How are they protected?**
For the demo, recording is host-side (the judge's browser). For a true legal record you need
**server-side SFU recording** — one authoritative file with retention, consent capture, and chain
of custody. That's the production approach (Phase 2).

**Q: Where would this be hosted?**
On NYS-controlled infrastructure for data residency and compliance (favoring self-hosted
SFU/TURN/storage), or a FedRAMP/StateRAMP-authorized service after review.

---

## 4. AI features

**Q: Is the AI actually working or just slides?**
Working. Four features: live captions/transcription, interpreter translation assist, AI hearing
summaries, and predictive wait-times. Captions run in the browser; wait-times are a live
heuristic; translation and summaries call a hosted model when configured, with an offline
fallback otherwise.

**Q: What AI model / where does the data go?**
It's provider-optional — with an API key it uses a hosted model (Anthropic in our build); without
one it falls back to deterministic offline behavior. In production you'd use a NYS-approved,
compliant model endpoint, given the sensitivity of hearing content.

**Q: How accurate are the AI summaries / captions? Can a judge rely on them?**
They're assistive, not authoritative. A summary is a draft for the judge to review; captions aid
accessibility. Production-grade accuracy, evaluation, and legal-record handling are the remaining
AI work (we moved the four features to "built" and kept hardening as the next phase).

**Q: Could AI introduce bias into hearings?**
That's exactly why AI here is assistive and human-in-the-loop — it never decides anything. Any
production use would need bias testing, transparency, and human review, consistent with state AI
policy.

**Q: How do predictive wait-times work?**
A heuristic: learned average hearing duration × queue position per officer, surfaced to
supervisors with docket-balancing suggestions. No black box, no PII — just operational timing.

---

## 5. Accessibility & multilingual

**Q: Is it accessible (ADA / 508)?**
Built on the NYS Design System with accessible components, focus states, contrast, and semantic
structure. A full WCAG 2.1/2.2 AA audit with assistive-tech testing is the production step.

**Q: What languages does it support?**
The full NYS language-access set — 12 languages plus English — switchable from a globe selector,
including right-to-left for Arabic, Urdu, and Yiddish. So an appellant can use the whole
interface in their native language.

**Q: Are those translations professional quality?**
English and Spanish are the most reviewed; the others cover the core UI and are demo-grade. A
production system would drop in NYS's official language-access translations — the framework is
already in place.

---

## 6. Data & integration

**Q: Where does the analytics data come from?**
Real NYS open data — SNAP caseloads from data.ny.gov via its Socrata API. For the prototype we
ship a committed CSV snapshot (works offline, deterministic) with an optional live refresh.

**Q: How does it integrate with IES?**
Through clearly marked `[INTEGRATION]` seams: we read hearing/participant data and write back
status/officer/participants. In the demo these are stubbed with seeded data; production wires them
to live IES APIs in both directions.

**Q: Can it handle evidence/documents?**
Yes — participants upload documents to a hearing (allow-listed types), stored server-side and
visible to the parties and the officer. Production adds virus scanning, access controls, and
retention.

---

## 7. Scale, reliability & operations

**Q: How many concurrent hearings can it handle?**
The waiting room scales horizontally (stateless app tier + Socket.io with a Redis adapter). Video
scale comes from the SFU. We'd load-test against real peak docket volumes before launch.

**Q: What if someone's internet drops mid-hearing?**
The demo has basic reconnection; production needs robust reconnect, state resync, and graceful
degradation — part of the reliability hardening.

**Q: Does it work on phones / poor connections?**
The UI is responsive and works across devices. Video on weak/home connections is exactly why
production needs an SFU (adapts quality per participant) rather than mesh.

---

## 8. Cost, timeline & "what's next"

**Q: What would production take?**
A multi-quarter effort with a dedicated team — but low *technical* risk (all solved problems).
The weight is integration, the SFU/recording backend, and security accreditation, not the app
logic (~60–70% of which is reusable).

**Q: What's the roadmap?**
Phase 1 productionize & integrate (real SSO/IES, DB, server-side authz); Phase 2 scale & record
(TURN + SFU, server-side recording); Phase 3 AI hardening (the four AI features are built —
remaining is accuracy, hosting, legal-record handling); Phase 4 expand (notifications, mobile,
analytics).

**Q: What's the single most valuable part?**
That NYS can own the conferencing layer end-to-end — no vendor lock-in for virtual hearings —
combined with the presence/readiness workflow WebEx can't provide.

---

## 9. Skeptical / curveball questions

**Q: Why not just buy an off-the-shelf product?**
You could, but you'd still lack the NYS-specific waiting-room workflow, you'd be locked to a
vendor's roadmap and data handling, and you'd pay per-seat indefinitely. This proves NYS can own
the capability and tailor it to IES.

**Q: Isn't this just a video call with extra steps?**
The video is the easy part. The value is *presence and readiness* — ensuring the right parties
are present and a hearing only starts when it should, plus oversight, audit, evidence, and access
(language + accessibility). That's the part no meeting tool does.

**Q: What's the weakest part of the demo, honestly?**
The production-grade pieces are intentionally stubbed: real auth, persistence, the SFU/recording
backend, and security accreditation. We were deliberate about proving workflow first and being
upfront about what's left.

**Q: How do we know the AI won't make something up in a summary?**
It's a reviewed draft, never the record, and a production deployment adds evaluation and
human-in-the-loop sign-off. We'd never let unverified AI text become an official document.

**Q: Could this be demoed with real users today?**
As a pilot of the *workflow*, with caveats (mock auth, mesh video). For real hearings it needs
the Phase 1–2 production work first. We wouldn't put real PII through the prototype.

---

## 10. One-liners to keep in your pocket

- "Built for the hackathon to prove the workflow; designed so the production path is clear."
- "The video is ours — no vendor lock-in."
- "AI assists, humans decide."
- "Honest about what's a prototype vs. what's production."
- "Access to justice: faster, fairer, multilingual, accessible hearings."

---

## 11. Things NOT to claim (guardrails)

- Don't say it's "secure and production-ready" — say the architecture is sound, hardening is scoped.
- Don't say recordings are a legal record yet — that needs server-side SFU recording.
- Don't claim all 13 languages are professionally translated — English/Spanish reviewed, others demo-grade.
- Don't claim it scales to huge rooms on mesh — that's what the SFU is for.
- Don't promise dates/costs you can't back up — defer to discovery.
