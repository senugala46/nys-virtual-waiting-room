# Build Guide — NYS Virtual Waiting Room (VWR)

A practical guide to set up, run, develop, verify, and deploy this project.

The app is a demo of the **NYS Virtual Waiting Room** for virtual fair hearings (OTDA / DOH /
OCFS) plus an **in-house WebRTC video conferencing** module. It runs as a single Node process
with an in-memory store — no database, no cloud, no API keys required.

---

## 1. Prerequisites

- **Node.js 18 or newer** (the `npm run dev` script uses `node --watch`, which needs ≥ 18).
  Check with `node -v`.
- **npm** (ships with Node).
- A **modern browser** — Chrome or Edge recommended (best WebRTC + `MediaRecorder` support).
  Firefox works; Safari is flakier for recording.

No global tooling, compilers, or bundlers are needed.

---

## 2. Install & run

```bash
npm install     # installs pinned deps: express, socket.io, @nysds/components, @nysds/styles
npm start       # starts the server -> http://localhost:3000
```

Open **http://localhost:3000**. To exercise the multi-user / video features, open the URL in
**several browser tabs** (or, ideally, on 2 devices on the same network — see §7).

Development mode (auto-restart on server changes):

```bash
npm run dev     # node --watch server.js
```

There is **no build step**. Frontend files in `public/` are served as-is — edit and refresh the
browser. Only `server.js` changes require a restart (`npm run dev` does this automatically).

---

## 3. Project layout

```
server.js               # Express + Socket.io: state, status engine, predictions, REST, signaling, recordings
ai.js                   # provider-optional AI: translation + hearing summaries (Anthropic or offline fallback)
public/
  index.html            # SPA shell: login, dashboards, conference overlay, globe language menu
  styles.css            # styling mapped onto NYS Design System tokens
  i18n.js               # internationalization: 13 languages baked in, t(), RTL
  app.js                # VWR client: role-based rendering, actions, search/sort/filter, recordings, summaries
  conference.js         # WebRTC mesh client: media, controls, chat, host controls, recording, live captions
data/                   # committed open-data snapshot (snap-caseloads.csv) for the analytics panel
recordings/             # saved hearing recordings (created at runtime)
evidence/               # uploaded evidence documents + index.json (created at runtime)
package.json            # pinned dependencies + scripts
PROMPT.md               # generated: verbatim reproduction kit (see §8)
build-prompt.js         # regenerates PROMPT.md from the source files
generate-deck.js        # generates the pitch deck (VWR-Pitch-Deck.pptx)
docs/                   # inputs for build-prompt.js
CLAUDE.md               # guidance for Claude Code instances
```

---

## 4. How it works (enough to develop confidently)

- **Single process, in-memory store.** `server.js` seeds hearings via `seedData()` on startup.
  Everything resets on restart or via the **Reset** button. `recordings/` on disk is the only
  persisted artifact.
- **Real-time via full-state broadcast.** Most actions go over Socket.io, not REST. Each handler
  mutates the store, recomputes status, then `broadcast()` sends a *complete* state snapshot to
  every client, which re-renders. This is why all tabs stay in sync. **Pattern for new features:
  mutate → `recomputeStatus` → `broadcast()`.**
- **Status lifecycle:** `not_checked_in → not_ready → ready → called → recalled → closed`.
  `called`/`recalled`/`closed` are officer-controlled ("sticky"). A hearing becomes **`ready`
  (Call unlocks) when at least one participant is checked in and available** (intentionally
  lenient for the demo — see `recomputeStatus` in `server.js` to tighten it).
- **Conferencing** is WebRTC **full mesh**; Socket.io only relays signaling (`conf:*` events in
  rooms named `conf:<hearingId>`). Media is peer-to-peer and never touches the server.
- **Recording** is host-side: the Hearing Officer's browser composites all tiles to a canvas,
  mixes audio, records with `MediaRecorder`, then downloads the `.webm` and uploads it to the
  server (`POST /api/recordings/:hearingId`).
- **Adjournment / withdrawal requests:** attendees emit `requestAction` (type adjournment|withdrawal
  + reason); the officer emits `resolveRequest` (granted|denied). A granted request closes the
  hearing with disposition "Adjourned"/"Withdrawn". Requests live on `hearing.requests` (in the
  state snapshot), shown on cards + flagged in the supervisor table.
- **Evidence upload:** participants attach documents via `POST /api/evidence/:hearingId` (raw
  body, metadata in query; allow-listed extensions, 25 MB cap). Files go to `evidence/` with a
  JSON index; the list flows into the state snapshot so cards update live. `GET /api/evidence/:hearingId` lists them.
- **Roles & SSO:** `POST /api/login` is a **mock IAM assertion** (pick a user from the seeded
  directory). This is the seam where real SSO (e.g. Okta / ITS IAM via OIDC) would plug in.
- **Multilingual UI:** `public/i18n.js` bakes in the NYS language-access set (12 languages +
  English), selected via the **globe menu (top-right)**. Switching is instant/offline.
  `VWRi18n.t('key', vars)` in `app.js` and `data-i18n` attributes in `index.html`; Arabic/Urdu/
  Yiddish switch to RTL. Add new strings to `i18n.js` (`en` + `es` at minimum).
- **AI features:** live captions (browser Web Speech API) feed a transcript; translation and
  hearing summaries go through `ai.js` (real with `ANTHROPIC_API_KEY`, else fallback); predictive
  wait-times are a heuristic in `computePredictions()`.
- **NYS open-data analytics:** `GET /api/opendata/snap` serves real SNAP caseload analytics from
  the **committed `data/snap-caseloads.csv` snapshot** (CSV-first — no network at runtime).
  `?live=1` refreshes from data.ny.gov's Socrata API and rewrites the CSV; optional
  `SOCRATA_APP_TOKEN` raises rate limits. Shown in the Supervisor view (charts via inline SVG/divs).

See `CLAUDE.md` for deeper architecture notes.

---

## 5. NYSDS build constraints (important)

The app uses the New York State Design System. Two specific builds are loaded in
`public/index.html`, and **switching either silently breaks the UI** — keep them as-is:

- **CSS:** `/nysds/styles/nysds.min.css` (tokens). Do **not** use `nysds-full.min.css` — its
  global element reset breaks the layout.
- **Components:** `/nysds/components/nysds.js` (UMD) as a classic `<script defer>`. Do **not**
  use `nysds.es.js` with `type="module"` — its bare `lit` imports won't resolve in the browser,
  so no `nys-*` component renders (the login button disappears).

NYSDS assets are served from `node_modules/@nysds/*/dist` via static routes in `server.js`, so
they come from `npm install` — no separate fetch needed.

---

## 6. Verifying changes (no test framework)

There are no automated tests or linter configured. Verify by hand:

**REST endpoints with curl:**
```bash
curl -s http://localhost:3000/api/directory | head -c 200
curl -s -X POST http://localhost:3000/api/login -H 'Content-Type: application/json' -d '{"userId":"alj-burns"}'
curl -s http://localhost:3000/api/report
curl -s http://localhost:3000/api/recordings
```

**Socket.io flows with a throwaway client** (the client lib isn't a project dependency):
```bash
cd /tmp && npm install socket.io-client --no-save
# then write a small script that connects to http://localhost:3000 and emits
# checkin / setAvailability / call / etc., asserting the broadcast 'state'
```
This is how the status engine, the officer one-at-a-time guard, reassign cleanup, and the
recording upload were validated during development.

**Manual demo path:** open 4+ tabs, sign in as different roles (e.g. Maria Gonzalez, David
Flores, the Spanish Interpreter, ALJ Patricia Burns), check in → Available → the hearing turns
**Ready** → ALJ **Call** → **Start** → everyone **Join Virtual Hearing** → try mute / screen
share / chat / record → ALJ **Close**. Sign in as Supervisor Lee Davis for the oversight
dashboard, audit log, and Recordings panel.

---

## 7. Browser & environment requirements for video

- `getUserMedia`, `getDisplayMedia`, `MediaRecorder`, and `canvas.captureStream` require a
  **secure context**. `localhost` counts as secure, so local dev works. **Any other host needs
  HTTPS** (terminate TLS at a reverse proxy or run the server behind one).
- **Multiple tabs on one machine share one physical camera** — some browsers show a black tile
  for the second tab. The connection still establishes. For a convincing demo, use **two devices
  on the same network**.
- Mesh video suits hearing-sized rooms (≤ ~8 participants). Beyond that, add a **TURN** server
  (NAT traversal) and an **SFU** (selective forwarding).

---

## 8. Regenerating docs/artifacts

- **`PROMPT.md` is generated — don't hand-edit it.** It embeds the verbatim source of every app
  file so the project can be reproduced identically elsewhere. After changing any app file:
  ```bash
  node build-prompt.js
  ```
  (Inputs: `docs/prompt-intro.md`, `docs/prompt-reference.md`, and the app files.)
- **Pitch deck:**
  ```bash
  npm install pptxgenjs --no-save
  node generate-deck.js        # writes VWR-Pitch-Deck.pptx
  ```

---

## 9. Configuration

Currently the only runtime knob is the port:

```bash
PORT=8080 npm start
```

**AI features (optional):** live captions use the browser Web Speech API (Chrome/Edge, no key).
Translation and hearing summaries are **provider-optional**:

```bash
ANTHROPIC_API_KEY=sk-ant-...  npm start   # enables real AI translation + summaries
```

Without the key they fall back to deterministic demo behavior. The real-AI path requires
**Node 18+** (uses global `fetch`); the demo fallback works on Node 16. Optional:
`ANTHROPIC_MODEL` (defaults to a fast model). Predictive wait-times are a built-in heuristic and
need no key.

There are no other required environment variables — the app is self-contained. (Real SSO, a
database, TURN/SFU, and storage config would be added when moving toward production.)

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Login button (or any `nys-*` element) missing** | Wrong NYSDS build loaded. `index.html` must use UMD `nysds.js` (classic script) and tokens `nysds.min.css` — see §5. |
| **Page looks unstyled / layout broken** | The `nysds-full.min.css` global reset is loaded. Switch back to `nysds.min.css`. |
| **"Call Hearing" stays disabled** | No participant is checked in *and* available. Check at least one in (check-in auto-sets Available). |
| **Can't start camera / join fails** | Not a secure context (non-localhost without HTTPS), or camera permission denied, or the camera is busy in another tab. |
| **Second tab shows a black video tile** | Same physical camera shared across tabs — expected; use a second device. |
| **Recording does nothing / no file** | Browser lacks `MediaRecorder` support (try Chrome/Edge), or not a secure context. Only the **host** records. |
| **Port already in use** | `PORT=8080 npm start`, or stop the existing process (`pkill -f "node server.js"`). |
| **Data looks stale/wrong** | It's in-memory — click **Reset** or restart the server to reseed. |

---

## 11. Toward production (not in scope for the demo)

The demo deliberately uses in-memory data, mock SSO, mesh video, and host-side recording. A
production build would add: a real database, real SSO federation (OIDC/SAML, e.g. Okta / ITS
IAM), server-side recording via an SFU, TURN servers, horizontal scaling (Socket.io Redis
adapter), HTTPS, server-enforced authorization, and the security/compliance controls a
government legal system requires. See the roadmap in `PITCH_SCRIPT.md` for the phased plan.
