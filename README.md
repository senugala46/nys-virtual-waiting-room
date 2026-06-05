# NYS ITS — Virtual Waiting Room (VWR)

A working hackathon demo of the **Virtual Waiting Room** for New York State fair hearings
(OTDA / DOH / OCFS). It manages **attendance, presence, flow, and waiting time** for Parties
of Interest (POIs) before a virtual hearing — the gap Cisco WebEx/CMR's stock waiting room
doesn't cover.

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3000**. Open it in **several browser tabs/windows**, sign in as
different roles, and watch the waiting-room status update **live** across all of them.

> Tip: Sign in as **Maria Gonzalez** (Appellant), **David Flores** (Rep), the
> **Spanish Interpreter**, and **ALJ Patricia Burns** in four tabs. As each checks in and
> goes *Available*, hearing **FH-2026-0001** flips `Not Checked In → Not Ready → Ready`,
> at which point the ALJ's **Call Hearing** button unlocks.

## Suggested demo script

1. **Appellant / Rep / Interpreter** tabs → *Check In* → *Available*.
2. Watch status climb to **Ready for Hearing** (all required parties available).
3. **Hearing Officer (ALJ)** tab → *Call Hearing* → *Start / Launch Conference* (WebEx link appears).
4. **Supervisor (Lee Davis)** tab → oversight table shows officer-in-hearing banner, live statuses, search & sort.
5. ALJ → *Close Hearing* with a disposition → status **Closed**; then *Recall* to reopen.
6. Open the bottom **Activity & Audit Log** drawer → live audit trail + operational metrics.

## Requirements coverage (from the RFP)

| Requirement | Where |
|---|---|
| Role-based permissions (9 roles) | `ROLES` in `server.js`, role scoping in `app.js` |
| Hearing can't commence until all parties (incl. ALJ) *Ready* | status engine `recomputeStatus()` |
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
| ITS IAM SSO (SAML2/OAuth/OIDC) | `/api/login` (mocked assertion) |
| IES integration (read + write-back) | `seedData()` / `pushToIES()` (stubbed) |
| Cisco WebEx/CMR conferencing | `startHearing()` (stubbed launch) |
| NYS branding, responsive, 508/ADA | `styles.css` (skip link, focus rings, contrast, breakpoints) |

## Architecture

```
Browser SPA  ──HTTP──▶  Express  (login, directory, report, static)
     ▲                     │
     └──── Socket.io ──────┘   live state snapshots broadcast on every change
                           │
                    in-memory store (seeded from "IES")
```

- **`server.js`** — Express + Socket.io, in-memory store, status engine, audit log.
- **`public/`** — single-page app (`index.html`, `app.js`, `styles.css`), no build step.

Integration seams to real NYS systems (IAM, IES, WebEx/CMR) are stubbed and marked
`[INTEGRATION]` in `server.js`.

## Notes

This is a demo: data is in-memory and resets on server restart (or via the **Reset** button).
No real PII, no external network calls.
