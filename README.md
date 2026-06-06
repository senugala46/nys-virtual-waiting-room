# NYS ITS — Virtual Waiting Room (VWR)

A working demo of the **Virtual Waiting Room** for New York State fair hearings (OTDA / DOH /
OCFS). It manages **attendance, presence, readiness, and flow** for Parties of Interest (POIs)
before a virtual hearing — the gap Cisco WebEx/CMR's stock waiting room doesn't cover — and
then runs the hearing on **in-house WebRTC video** with **live captions, recording, AI hearing
summaries**, and a **multilingual (13-language) interface**.

Runs as a single Node process with an in-memory store: no database, no cloud, no API keys
required.

## Quick start

```bash
npm install
npm start            # http://localhost:3000   (Node 18+ recommended)
```

Open it in **several browser tabs/windows**, sign in as different roles, and watch the
waiting-room status update **live** across all of them. Use **Chrome or Edge** for the video,
captions, and recording features.

> Tip: Sign in as **Maria Gonzalez** (Appellant) in one tab and **ALJ Patricia Burns** in
> another. The appellant checks in → goes *Available* → hearing **FH-2026-0001** turns
> **Ready** → the ALJ's **Call Hearing** unlocks. (Readiness rule: a hearing is Ready as soon
> as **at least one** participant is checked in and available — see note below.)

## Feature highlights

- **Role-based waiting room** for 9 roles, with a real-time **status lifecycle**
  (`not_checked_in → not_ready → ready → called → recalled → closed`).
- **In-house video conferencing** (WebRTC mesh) — mute, camera, screen share, chat, host
  mute/remove. No third-party meeting vendor.
- **Evidence upload** — participants attach documents (PDF/images/Office/text) to their hearing;
  files are stored server-side and listed on the hearing card (with a count in the supervisor table).
- **Recording** — the host records a composite of all tiles + mixed audio; the file downloads
  and is saved server-side; a **Recordings panel** in the supervisor view plays them back.
- **AI assistance** — **live captions/transcription** (browser Web Speech API), **interpreter
  translation assist**, **AI hearing summaries** for judges, and **predictive wait-times** for
  docket balancing.
- **Multilingual UI** — NYS language-access set (**12 languages + English**) via a globe
  selector (top-right), with RTL for Arabic/Urdu/Yiddish.
- **Supervisor oversight** dashboard, **operational reporting**, and a full **audit log**.
- **NYS open-data analytics** — real SNAP caseload data from **data.ny.gov** (committed CSV
  snapshot, optional live refresh) charted in the supervisor view for benefits context.
- Built on the **NYS Design System** (NYSDS); 508/WCAG-minded; responsive.

## Suggested demo script

1. **Appellant / Rep / Agency Rep** tabs → *Check In* → *Available*; status climbs to **Ready**.
2. **Hearing Officer (ALJ)** tab → *Call Hearing* → *Start / Launch Conference*.
3. Everyone clicks **Join Virtual Hearing** → try mute, screen share, chat, **Captions** (pick a
   language to see interpreter translation), and **Record**.
4. ALJ card → **Generate** an **AI Hearing Summary** from the transcript.
5. **Supervisor (Lee Davis)** tab → oversight table (live statuses, **Est. wait** column,
   docket-balancing tip) + **Recordings panel** + **Activity & Audit Log** drawer.
6. Click the **globe (top-right)** → pick **Español**, **中文**, **العربية**… → the UI switches
   instantly.

## Requirements coverage (from the RFP)

| Requirement | Where |
|---|---|
| Role-based permissions (9 roles) | `ROLES` in `server.js`, role scoping in `app.js` |
| Hearing readiness gate before it can commence | status engine `recomputeStatus()` (demo rule: ≥1 ready) |
| Sort by custom criteria (time, name, status, agency) | toolbar `#sort` |
| Search on predefined criteria | toolbar `#search` |
| Check into multiple hearings / view list / check out | party card controls |
| Availability (Available/Unavailable) | availability toggle |
| Officer: one hearing at a time | `officerActiveHearing()` enforcement |
| Officer: call/deny, start conference, reassign, close, recall | officer controls + socket events |
| Supervisor: view all, statuses, attendees, officers attending, search | supervisor table |
| Interpreter/witness: limited view | `limited` flag in `renderCard()` |
| Waiting-room status lifecycle | `WR_STATUS` state machine |
| Check-in time & participant status tracking | participant model |
| Operational reporting & metrics | `/api/report` + report strip |
| Auditing | `auditLog` + audit drawer |
| In-house video conferencing (replaces WebEx/CMR) | `conference.js` (WebRTC) + `conf:*` signaling |
| Hearing recording | host capture in `conference.js` + `/api/recordings` |
| Evidence/document upload | `/api/evidence/:hearingId` + evidence section on the card |
| AI: captions, translation, summaries, wait-times | `conference.js`, `ai.js`, `computePredictions()` |
| Multilingual UI (12 languages + English, RTL) | `i18n.js` + globe selector |
| NYS open-data analytics (data.ny.gov) | `/api/opendata/snap` + Supervisor panel; CSV snapshot in `data/` |
| ITS IAM SSO (SAML2/OAuth/OIDC) | `/api/login` (mocked assertion) |
| IES integration (read + write-back) | `seedData()` / `pushToIES()` (stubbed) |
| NYS branding, responsive, 508/ADA | NYSDS tokens + components in `styles.css` / `index.html` |

## Architecture

```
Browser SPA  ──HTTP/Socket.io──▶  Express + Socket.io  (login, directory, report,
     ▲   │                          recordings, AI, WebRTC signaling, static)
     │   └──── live state snapshots broadcast on every change ──────┘
     │                                    │
     └─ WebRTC peer-to-peer (mesh) ─┐     └─ in-memory store (seeded from "IES")
        media never touches server  ┘        + recordings/ on disk
```

- **`server.js`** — Express + Socket.io, in-memory store, status engine, predictions, audit log, REST.
- **`ai.js`** — provider-optional translation + summaries (Anthropic if `ANTHROPIC_API_KEY`, else fallback).
- **`data/snap-caseloads.csv`** — committed data.ny.gov snapshot powering the analytics panel (refresh via `GET /api/opendata/snap?live=1`).
- **`public/`** — single-page app: `index.html`, `styles.css`, `i18n.js`, `app.js`, `conference.js`. No build step.

Integration seams to real NYS systems (IAM, IES) are stubbed and marked `[INTEGRATION]` in
`server.js`. See `BUILD_GUIDE.md` for setup/run details, `CLAUDE.md` for architecture, and
`PRD.md` for requirements.

## Notes

- Data is in-memory and resets on server restart (or the **Reset** button). `recordings/` on
  disk is the only persisted artifact. No real PII.
- **Video/captions/recording** need a secure context (works on `localhost`; HTTPS elsewhere)
  and are best in **Chrome/Edge**.
- **AI translation & summaries** are real with `ANTHROPIC_API_KEY` (Node 18+); otherwise they
  use an offline fallback. **Captions** and **wait-times** need no key.
- The 13-language UI is fully functional offline; English & Spanish are the most reviewed —
  production would use NYS's official language-access translations.
