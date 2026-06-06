
## ROLE & GOAL

You are building a **working hackathon demo** of the **New York State (NYS) ITS Virtual
Waiting Room (VWR)** for virtual fair hearings (agencies: OTDA, DOH, OCFS), plus an
**in-house video conferencing** module that replaces Cisco WebEx/CMR.

The app manages **attendance, presence, flow, and waiting time** for Parties of Interest
(POIs) *before* a hearing, then lets them join a real peer-to-peer video hearing. It must run
with **zero external services** (no DB, no cloud, no API keys) and be demoable across multiple
browser tabs on one machine.

Deliver a complete, runnable project. After building, start the server and verify it works.

---

## TECH STACK (keep it minimal, no build step)

- **Backend:** Node.js + **Express** (static serving + small REST surface) + **Socket.io**
  (real-time state broadcast and WebRTC signaling).
- **Frontend:** plain **HTML/CSS/vanilla JS** single-page app served from `/public`. No
  framework, no bundler, no transpiler.
- **Video:** **WebRTC full-mesh** (`RTCPeerConnection`) using public STUN servers; Socket.io
  is the signaling channel.
- **Recording:** client-side **`MediaRecorder`** (host composites all tiles to a canvas + mixes
  audio); the file is downloaded locally AND uploaded to the server (`recordings/` on disk).
- **AI features (`ai.js`):** live captions/transcription (browser **Web Speech API**), interpreter
  translation assist, and AI hearing summaries — **provider-optional** (Anthropic API if
  `ANTHROPIC_API_KEY`, else deterministic offline fallback). Predictive wait-times are a heuristic.
- **Internationalization (`public/i18n.js`):** NYS language-access set (**12 languages + English**)
  baked in for instant offline switching; globe selector (top-right); RTL for Arabic/Urdu/Yiddish.
- **Design system:** **NYS Design System (NYSDS)** via npm packages `@nysds/styles` and
  `@nysds/components`. Serve from `node_modules`. **Critical build choices (these tripped us up):**
  - Load the **tokens** stylesheet `@nysds/styles/dist/nysds.min.css` — NOT `nysds-full.min.css`.
    The "full" build applies a global `*`/`body`/`h1-3`/`a`/`table` reset that wrecks a custom
    dashboard layout. The tokens build gives the CSS variables only.
  - Load the **UMD** components build `@nysds/components/dist/nysds.js` as a **classic
    `<script>`** — NOT the ESM `nysds.es.js` with `type="module"`. The ESM build has bare
    imports (`import ... from "lit"`) the browser can't resolve without a bundler, so it
    silently fails to load and **no `nys-*` element renders** (e.g. the login button vanishes).
  - Components used: `nys-globalheader` (official agency header), `nys-button`, `nys-icon`,
    `nys-badge`. (Do **not** use `nys-unavheader`/`nys-skipnav`.)
- **Data:** in-memory store, seeded at startup. Resets on restart or via a "Reset" button.
  (Recordings are the one thing written to disk.)

---

## FILE STRUCTURE

```
package.json            # deps: express, socket.io, @nysds/components, @nysds/styles
server.js               # Express + Socket.io: state, status engine, predictions, REST, signaling
ai.js                   # provider-optional AI: translation + summaries (Anthropic or fallback)
public/
  index.html            # SPA shell: login, dashboards, conference overlay, globe language menu
  i18n.js               # 13 languages baked in, t(), RTL
  app.js                # VWR client: role-based rendering, actions, search/sort/filter, recordings, summaries
  conference.js         # WebRTC mesh client: media, controls, chat, host controls, recording, captions
  styles.css            # styling mapped onto NYSDS tokens
recordings/             # saved hearing recordings (created at runtime)
README.md               # how to run + demo script
```

Run with `npm install && npm start`, listening on `http://localhost:3000`.

---

## DOMAIN REQUIREMENTS (from the RFP)

### Roles (9) — permissions/visibility differ per role
`appellant`, `appellant_rep`, `appellant_witness`, `agency_rep`, `agency_witness`,
`interpreter`, `hearing_officer` (ALJ), `admin_staff`, `supervisor`.

### Waiting-room status lifecycle (state machine)
`not_checked_in` → `not_ready` → `ready` → `called` → `recalled` → `closed`
- **not_checked_in** (default): nobody is checked in.
- **not_ready:** at least one participant is checked in, but none are currently "Available".
- **ready:** **at least one** participant is checked in AND "Available" → Call Hearing unlocks.
- **called / recalled / closed:** set explicitly by the Hearing Officer (these are "sticky"
  and are NOT recomputed from check-ins).

> Readiness rule note: the original RFP rule was "all required parties (incl. the ALJ) must be
> ready." This demo intentionally uses the looser **"at least one checked in + available"** rule
> so Call unlocks quickly in a demo. (Swap the predicate in `recomputeStatus` to restore strict.)

### Participant tracking
Each participant has: `userId`, `name`, `role`, `required` (bool), `checkedIn` (bool),
`checkInTime` (ISO), `status` (`available` | `unavailable`), optional `denied`.
Track **check-in times** and per-participant availability.

### Functional requirements by role
- **Appellant / Rep / Agency Rep / Witness:** check into multiple hearings; view their
  hearings; check in/out; toggle Available/Unavailable; view other participants' statuses.
- **Interpreter / Witness:** like above but a **limited view** — cannot see full participant
  details of others.
- **Hearing Officer (ALJ):**
  - Restricted to **one active hearing at a time** (enforce server-side: block calling a
    second hearing while another is `called`/`recalled`).
  - See only hearings assigned to them; check in + set availability themselves.
  - **Call** (or **Recall**) a hearing; **Deny/Remove** a participant; **Start** the hearing
    (launch conference); **Reassign** to another officer; **Close** with a disposition;
    **Recall** a closed hearing.
  - When not yet `ready`, show a hint: "Waiting for at least one participant to check in and be available."
- **Supervisor / Admin Staff:** oversight **table** of ALL hearings — sortable, searchable;
  shows statuses, checked-in counts, assigned officer, disposition, and a banner of which
  officers are currently in a hearing. **Plus a "Recordings" panel** listing saved recordings
  (inline `<video>` players + download links) from `GET /api/recordings`.

### Cross-cutting
- **Sort** hearings by scheduled time, appellant name, status, agency.
- **Search** across hearing number, appellant name, type, agency, category of aid.
- **Filter** by status.
- **Operational reporting** endpoint + a metrics strip (counts by status, total check-ins, by agency).
- **Audit log** of every meaningful action (login, check-in/out, availability, call, deny,
  start, reassign, close, recall, conference join/leave, host actions) — shown in a drawer.
- **Integration seams** stubbed and clearly marked `[INTEGRATION]`:
  - ITS IAM SSO (SAML2/OAuth/OIDC) → mock `/api/login` returning a signed-assertion-shaped
    session `{ sub, name, role, roleLabel, issuer }`.
  - IES source-of-truth → `seedData()`.
  - IES write-back → `pushToIES()` (logs to audit).
  - Cisco WebEx/CMR → replaced by the in-house conference.

### AI assistance
- **Live captions / transcription** in the conference (browser Web Speech API), broadcast via
  `conf:caption` and accumulated into `hearing.transcript`.
- **Interpreter translation assist** — a language selector translates live captions via
  `POST /api/ai/translate`.
- **Automated hearing summaries** for the judge from the transcript via `POST /api/ai/summarize`.
- **Predictive wait-times** per hearing + docket-balancing suggestions (`GET /api/predictions`,
  also in the state snapshot), shown on cards and in the supervisor table.
- All AI is **provider-optional** (`ai.js`): real with `ANTHROPIC_API_KEY` (Node 18+), else a
  deterministic offline fallback. Captions and wait-times need no key.

### Multilingual UI
- The interface supports the **NYS language-access set (12 languages + English)** via a globe
  selector (top-right). All languages are **baked into `i18n.js`** for instant offline switching;
  Arabic/Urdu/Yiddish render RTL. Static HTML uses `data-i18n*` attributes; dynamic strings use
  `VWRi18n.t()`. (The conference overlay is not yet localized.)

---

## SEED DATA (4 hearings, today's date)

1. **FH-2026-0001** — Medicaid Fair Hearing, DOH, 09:00, appellant Maria Gonzalez, officer
   ALJ Patricia Burns. Parties: appellant, appellant_rep (David Flores), agency_rep (DOH
   Caseworker), hearing_officer (Burns), interpreter (Spanish, required). *(5 required parties
   — the heaviest hearing.)*
2. **FH-2026-0002** — SNAP, OTDA, 09:30, appellant James Whitfield, officer ALJ Burns.
   Parties: appellant, agency_rep, hearing_officer; agency_witness (not required).
3. **FH-2026-0003** — Child Care Subsidy, OCFS, 10:00, appellant Aisha Bello, officer
   ALJ Robert Chen. Parties: appellant, appellant_rep, agency_rep, hearing_officer.
4. **FH-2026-0004** — Temporary Assistance, OTDA, 10:30, appellant Robert Klein, officer
   ALJ Chen. Parties: appellant, agency_rep, hearing_officer. *(Lightest — quickest to Ready.)*

**Directory of demo users** (for the SSO dropdown), each `{ userId, name, role }`: the
appellants/reps/agency reps/interpreter above, both ALJs (Burns `alj-burns`, Chen `alj-chen`),
a supervisor (Lee Davis), and an admin clerk (Tina Ramos).

---

## BACKEND BEHAVIOR (`server.js`)

### REST
- `GET /api/directory` → `{ directory, roles }` (roles = label/group/multiHearing map).
- `POST /api/login {userId}` → session object (mock IAM assertion); 404 if unknown.
- `GET /api/report` → `{ totalHearings, statusCounts, totalCheckIns, byAgency, generatedAt }`.
- `POST /api/recordings/:hearingId?name=<file>` → accepts a **raw binary** body
  (`express.raw({ type: () => true, limit: '1gb' })`), writes it to `recordings/` (sanitize the
  filename), audits it, returns `{ ok, file, bytes, url }`.
- `GET /api/recordings` → `[{ file, bytes, savedAt, url }]` (newest first).
- Serve `/public` statically; serve NYSDS at `/nysds/styles` and `/nysds/components`; serve
  `recordings/` statically at `/recordings` for playback/download.

### Status engine
`recomputeStatus(h)`: if status is sticky (called/recalled/closed) return; else if **no
participant** is checked in → `not_checked_in`; else if **at least one** participant is
`checkedIn && status==='available'` → `ready`, otherwise `not_ready`.

### Socket.io events (VWR)
`identify`, `checkin`, `checkout`, `setAvailability`, `call` (with one-hearing-at-a-time
guard; emit a `toast` error if violated), `deny`, `startHearing` (set a `conferenceUrl`,
flip ready→called), `reassign` (set `assignedOfficerId`, **remove the previous officer** from
participants, add the new one), `closeHearing` (set disposition, clear conferenceUrl),
`reopen` (→ recalled), `resetDemo`. After any mutation: recompute + **broadcast a full state
snapshot** `{ hearings, auditLog, serverTime }` to all clients.

### Socket.io events (Conference signaling — WebRTC mesh)
Rooms named `conf:<hearingId>`:
- `conf:join {hearingId, user}` → store `socket.data.confUser`, join room, reply to the
  newcomer with `conf:peers {peers:[existing]}`, notify others `conf:peer-joined`, broadcast
  `conf:roster`.
- `conf:signal {to, data}` → relay SDP/ICE to that specific socket (`io.to(to)`), include
  `{from, data, user}`.
- `conf:leave` / `disconnect` → notify `conf:peer-left {id}`, leave room, rebroadcast roster.
- `conf:chat {hearingId, text}` → broadcast `{from, role, text, ts}` to the room.
- `conf:host-mute {target}` / `conf:host-remove {target}` → relay `conf:force-mute` /
  `conf:force-remove` to that socket.
- `conf:rec {hearingId, on}` → broadcast `conf:rec {on}`.

---

## FRONTEND BEHAVIOR

### `app.js` (VWR)
- One Socket.io connection; expose `window.VWRSocket`, `window.VWRSession`, `window.VWRToast`
  so `conference.js` can reuse them.
- Login: fetch directory, populate the SSO `<select>`, POST `/api/login`, store session,
  `emit('identify')`, enter app.
- On `state`, re-render. Role-scope visible hearings (officer → assigned; parties → hearings
  they're in; supervisor/admin → all). Apply search + sort + status filter.
- **Card view** (parties AND officer): header with hearing #, type, agency, status badge; meta
  (appellant, time, aid, disposition); the current user's own controls — **everyone, including
  the Hearing Officer**, gets Check In → Available/Unavailable toggle + Check Out; officer also
  gets officer controls; participant list; "Join Virtual Hearing" button when `conferenceUrl` set.
- **Officer controls:** Call (disabled until `ready`, with the "Waiting for at least one
  participant…" hint), Start + Close while in hearing, Recall when closed, Reassign `<select>`.
- **Supervisor table view:** a **Recordings panel** (grid of inline `<video>` players + size,
  timestamp, download — from `GET /api/recordings`, with a refresh button) above a
  banner of officers-in-hearing + sortable rows.
- Audit drawer (toggle) showing the report metrics strip + recent audit entries.
- Toast notifications; live clock; connection indicator. Expose `window.VWRToast`.

### `conference.js` (WebRTC)
- `window.VWRConf.join(hearingId, hearingNumber, isHost)` opens a full-screen overlay.
- `getUserMedia({video,audio})` with graceful fallback (audio-only, then viewer-only).
- Full mesh: **newcomer initiates** offers to each existing peer (only the initiator sets
  `onnegotiationneeded` to avoid glare); non-initiator lazily creates the peer on first
  signal and answers. Relay ICE via `conf:signal`. Render a video tile per peer + self-view.
- Controls: **mute mic, start/stop camera, screen share** (`getDisplayMedia` +
  `sender.replaceTrack`), **chat panel**, **leave**. Host-only: **record** toggle and per-tile
  **Mute / Remove**. Handle `conf:force-mute` / `conf:force-remove`. Broadcast `conf:rec` so all
  peers show a blinking REC indicator.
- **Recording engine (host only):** on record, draw all on-screen `<video>` tiles into a grid on
  a hidden `<canvas>` each frame (`canvas.captureStream(25)`), mix every participant's audio via
  `AudioContext` + `MediaStreamAudioDestinationNode` (connect self + each peer; reconnect late
  joiners in `ontrack`), combine into one `MediaStream`, and feed `MediaRecorder` (prefer
  `video/webm;codecs=vp9,opus`, fall back to vp8/webm). On stop → build a `Blob`, **auto-download**
  it (`hearing-<num>-<timestamp>.webm`) AND `POST` it to `/api/recordings/:hearingId`. Stop the
  recorder if the host leaves.
- AV icons: NYSDS has none, so inline **Material** SVGs (`fill="currentColor"`): mic/mic_off,
  videocam/videocam_off, screen_share, chat, call_end, record (circle), remove (✕).
- Roster count; live mic/cam status badge on self-tile.

---

## STYLING & ICONS (NYS Design System)

- In `index.html`: load the **tokens** CSS `/nysds/styles/nysds.min.css` (NOT the full build),
  and the **UMD** components `/nysds/components/nysds.js` as a classic `<script defer>` (NOT the
  ESM build — see Tech Stack). Default theme is NYS **state-blue**.
- In `styles.css`, **map your semantic CSS variables onto NYSDS tokens**, e.g.
  `--nys-color-theme` (state-blue-700, #154973), `--nys-color-accent` (gold #face00),
  `--nys-color-surface`, `--nys-color-text`, `--nys-color-success/warning/danger`,
  `--nys-radius-*`, and the `--nys-font-family-sans` (Proxima Nova) stack. Because you load only
  tokens (no global reset), set your own base typography (font-size, line-height, smoothing).
- **Chrome:** put `nys-globalheader` (attrs `appName`, `agencyName`, `homepageLink`, `nysLogo`)
  at the top of the app — its background is `--nys-color-theme`, so keep the custom topbar the
  same blue and they merge into one masthead with a gold accent line. Slim the topbar to live
  status + user/role + Reset/Sign out (no duplicate branding). No universal banner, no skipnav.
- Use NYSDS components: `nys-button` (primary/neutral actions; always theme-blue — clicks bubble
  to the host so `element.onclick` works; use its `disabled` attribute for Call gating),
  `nys-icon` (icons), `nys-badge` (participant availability: success/warning/error/neutral).
- **Keep destructive actions semantic red** (Close/Deny/Remove) as custom token-styled
  buttons, since `nys-button` has no danger color. Keep the 6-state status pills custom
  (token-colored) so `ready` (green) and `called` (blue) stay visually distinct.
- **Icon caveat:** `nys-icon` ships ~80 icons but **none of the AV ones**, so the conference
  uses inline Material SVGs (see conference.js). For VWR `nys-icon`, valid names you'll use
  include: `search`, `refresh`, `close`, `lock_filled`, `check_circle`, `progress_activity`,
  `phone_in_talk`, `account_circle`, `cancel`, `check`, `remove`, `download`. (Validate any icon
  name against the bundle before using it.)
- Accessibility (508/WCAG): visible focus rings, sufficient contrast, semantic landmarks,
  responsive layout (cards collapse to one column; supervisor table scrolls). *(Note: a
  skip-to-main link was removed at the user's request — re-add for full compliance.)*

---

## ACCEPTANCE CRITERIA (verify before finishing)

1. `npm install && npm start` serves the app at `http://localhost:3000`; all assets and the
   NYSDS paths return `200`. **In the browser, `nys-button`/`nys-icon` actually render** (proof
   the UMD components build loaded — if the login button is invisible you loaded the wrong build).
2. Status engine: with **one** participant checked in & available, the hearing is `ready` and
   the officer's **Call** unlocks; if everyone checked-in goes Unavailable → `not_ready`; nobody
   checked in → `not_checked_in`.
3. **Officer one-at-a-time** is enforced: calling a second hearing while one is active is
   rejected with a toast.
4. **Reassign** swaps the officer cleanly — the previous ALJ is removed; exactly one officer
   remains. The **Hearing Officer can check in / set their own availability** on their cards.
5. Two browser tabs joining the same hearing's conference discover each other, exchange
   SDP/ICE, and show each other's video tiles; mute, screen share, chat, and host
   mute/remove all work; leave cleans up.
6. **Recording:** host records → a `.webm` downloads AND `POST /api/recordings/...` saves it to
   `recordings/`; `GET /api/recordings` lists it; the Supervisor **Recordings panel** plays it.
7. Supervisor sees all hearings with live statuses; search/sort/filter work; audit drawer and
   report metrics populate.
8. UI uses NYSDS tokens/components + `nys-globalheader`; conference controls use SVG AV icons (no emoji).

### Suggested manual demo
Open 4+ tabs. Sign in as Maria Gonzalez, David Flores, the Spanish Interpreter, the DOH
Caseworker, and ALJ Patricia Burns. Each checks in and goes Available → FH-2026-0001 reaches
**Ready** → ALJ **Call** → **Start** → everyone clicks **Join Virtual Hearing** → demo video,
chat, screen share, host controls → ALJ **Close** with a disposition → **Recall**. Sign in as
Supervisor Lee Davis to show the oversight dashboard and audit log. *(FH-2026-0004 is the
fastest path to Ready — only 3 required parties.)*

---

## NOTES / GOTCHAS

- **NYSDS builds (the two biggest traps):** use the **tokens** CSS (`nysds.min.css`) not the
  full build (its global reset breaks the layout); use the **UMD** components (`nysds.js`) as a
  classic script, not the ESM build (bare `lit` imports → nothing renders). If components look
  unstyled/invisible, you picked the wrong build.
- `getUserMedia` / `MediaRecorder` / `canvas.captureStream` need a **secure context**: work on
  `localhost`; any other host needs HTTPS. Chrome/Edge/Firefox support `MediaRecorder`; Safari
  is flakier.
- Recording is **host-side and demo-grade**: it captures the hearing as the host's browser sees
  it; if the host's tab closes without "Leave," that recording is lost. Production needs
  **server-side SFU recording**.
- Multiple tabs on one machine share one physical camera — some browsers show a black tile for
  the second tab; connections still establish. Best demoed on 2 devices on the same network.
- Full mesh suits hearing-sized rooms (≤ ~8). For larger, add a TURN server and/or an SFU.
- `nys-button` clicks bubble to the host element, so `element.onclick`/`addEventListener`
  wiring on the `<nys-button>` works; use its `disabled` attribute for the Call gating.
- Keep all data in memory; provide a **Reset** button (emits `resetDemo`) for clean demos.
  (`recordings/` on disk is the exception — gitignore it if you init a repo.)
