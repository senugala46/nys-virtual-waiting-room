# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A working demo of the **NYS ITS Virtual Waiting Room (VWR)** for virtual fair hearings (OTDA / DOH / OCFS), plus an **in-house WebRTC video conferencing** module that replaces Cisco WebEx/CMR. It manages attendance, presence, readiness, and flow before a hearing, then runs the hearing as peer-to-peer video.

## Commands

```bash
npm install        # install pinned deps (express, socket.io, @nysds/*)
npm start          # run the server -> http://localhost:3000
npm run dev        # same, with --watch auto-restart on file changes
```

- **No build step.** The frontend is vanilla HTML/CSS/JS served straight from `public/`. Editing `public/*` only needs a browser refresh; editing `server.js` needs a restart (`npm run dev` handles this).
- **No test framework and no linter.** Verification in this repo is done by hand: `curl` for REST endpoints and short throwaway `socket.io-client` scripts to drive Socket.io flows (the client lib isn't a dependency — install it ad hoc with `npm install socket.io-client --no-save` in a tmp dir and point the require at it). Example checks performed during development: confirm status transitions, the officer one-at-a-time guard, reassign cleanup, and the recording upload pipeline.

## Architecture (the big picture)

Single Node process. **`server.js`** is Express + Socket.io with an **in-memory store** (`hearings`, `auditLog`) seeded by `seedData()` at startup; everything resets on restart or the Reset button. There is no database — `recordings/` on disk is the only persisted artifact.

**Real-time model — full-state broadcast.** Almost all mutations happen over Socket.io, not REST. Every handler mutates the in-memory store, calls `recomputeStatus`, then `broadcast()` emits a *complete* state snapshot (`{ hearings, auditLog, serverTime }`) to all clients. The client re-renders from scratch each time. This is why multiple browser tabs stay in sync. When adding a feature, follow this pattern: mutate → recompute → `broadcast()`; don't try to send deltas.

**Status engine** (`recomputeStatus` in `server.js`) drives the 6-state lifecycle `not_checked_in → not_ready → ready → called → recalled → closed`. `called`/`recalled`/`closed` are **sticky** (officer-owned, in the `STICKY` set) and are never recomputed from check-ins. The readiness rule is intentionally **lenient**: a hearing is `ready` (Call unlocks) as soon as **at least one** participant is checked in AND available — *not* the stricter "all required parties" rule from the RFP. To restore strict behavior, change the predicate in `recomputeStatus`.

**Conferencing is two separate Socket.io concerns in the same connection.** The VWR events (`checkin`, `call`, `closeHearing`, …) and the conference signaling events (`conf:join`, `conf:signal`, `conf:chat`, `conf:host-mute`, `conf:rec`, …) coexist. Conference peers live in Socket.io rooms named `conf:<hearingId>`. The server is **only a signaling relay** — `conf:signal` forwards SDP/ICE to one specific socket; media never touches the server.

**`public/conference.js`** is a WebRTC **full mesh**. Key invariants: the **newcomer initiates** offers to each existing peer (returned via `conf:peers`), and **only the initiator sets `onnegotiationneeded`** to avoid offer/answer glare; the non-initiator lazily creates the `RTCPeerConnection` on the first inbound signal. Mesh suits ≤ ~8 participants; scaling past that means TURN + an SFU.

**Recording is host-side and demo-grade.** Only the Hearing Officer records. `conference.js` composites every on-screen `<video>` onto a hidden `<canvas>` (`captureStream`), mixes all peers' audio via `AudioContext` + `MediaStreamAudioDestinationNode`, feeds the combined stream to `MediaRecorder`, then on stop both downloads the `.webm` and `POST`s it to `/api/recordings/:hearingId`. The server saves it to `recordings/` and serves it back at `/recordings/<file>`; the Supervisor view lists them via `GET /api/recordings`.

**Cross-file wiring (frontend).** `app.js` and `conference.js` are independent scripts that share state through window globals: `app.js` sets `window.VWRSocket`, `window.VWRSession`, `window.VWRToast`; `conference.js` reads them and exposes `window.VWRConf.join(...)`, which the "Join Virtual Hearing" button calls. There is no module system.

**Internationalization (`public/i18n.js`).** The UI supports the NYS language-access set (12 languages + English). `VWRi18n.t('key', vars)` looks up strings; static HTML uses `data-i18n` / `data-i18n-ph` / `data-i18n-title` / `data-i18n-label` (the last sets a `nys-button` `label`). **English + Spanish are baked in**; the other 11 languages are fetched on demand from `POST /api/ai/translate-ui` (real with `ANTHROPIC_API_KEY`, cached in `localStorage`) and **fall back to English** when no key — never show unverified machine text by default. Arabic/Urdu/Yiddish set `dir="rtl"`. Changing language calls `window.VWRonLangChange` → re-render. When adding user-facing strings, add a key to both `en` and `es` in `i18n.js` and use `t()` in `app.js` (or `data-i18n` in HTML). Note: the conference overlay (`conference.js`) is not yet localized.

**Role-based rendering.** `app.js` scopes visible hearings by role (officer → assigned; parties → hearings they're in; supervisor/admin → all) and renders either cards (parties/officer) or the oversight table (supervisor/admin). Authorization is currently client-side only — the server trusts the client.

**Integration seams are stubbed and marked `[INTEGRATION]`** in `server.js`: ITS IAM SSO (mock `POST /api/login`), IES read (`seedData()`), IES write-back (`pushToIES()` → audit log), and conferencing (replaced by the in-house module).

**AI features (`ai.js`) are provider-optional.** Live captions are produced **in the browser** via the Web Speech API (`conference.js`), broadcast as `conf:caption`, and final results accumulate into `hearing.transcript`. Translation (interpreter assist) and hearing summaries go through `ai.js`, which calls the **Anthropic API only if `ANTHROPIC_API_KEY` is set** (uses global `fetch`, so Node 18+); otherwise it returns deterministic fallbacks (a small phrase map / an extractive summary) so the demo works offline. Predictive wait-times (`computePredictions` in `server.js`) are a **pure heuristic** — learned avg hearing duration × queue position per officer — included in the state snapshot and surfaced in the supervisor view. When touching these, keep the no-key fallback working.

## NYSDS — two non-obvious constraints (do not "fix" these)

The app uses the New York State Design System. `index.html` loads two specific builds, and switching either one silently breaks the UI:

- **CSS:** load the tokens build `/nysds/styles/nysds.min.css`. Do **not** switch to `nysds-full.min.css` — its global element reset (`*`, `body`, `h1-3`, `a`, `table`) destroys the custom layout. `styles.css` maps its own semantic variables onto NYSDS tokens (`--nys-color-theme`, `--nys-color-accent`, etc.).
- **Components:** load the UMD build `/nysds/components/nysds.js` as a classic `<script defer>`. Do **not** switch to the ESM `nysds.es.js` with `type="module"` — it has bare `import ... from "lit"` specifiers the browser can't resolve, so it fails silently and **no `nys-*` element renders** (the login button disappears). NYSDS assets are served from `node_modules/@nysds/*/dist` via static routes in `server.js`.

NYSDS ships ~80 icons but **none of the audio/video ones**, so `conference.js` inlines Material SVG icons (mic, videocam, screen_share, call_end, record) for the conference controls. Validate any `nys-icon name="…"` against the bundle before using it. `nys-button` is always theme-blue (no danger variant), so destructive actions (Close/Deny/Remove) stay as custom token-styled red buttons.

## Docs & generated artifacts

- **`PROMPT.md` is generated — do not hand-edit it.** It embeds the verbatim source of every app file so the project can be reproduced identically in another CLI. After changing any app file, regenerate it: `node build-prompt.js` (inputs: `docs/prompt-intro.md`, `docs/prompt-reference.md`, and the app files; it verifies nothing itself, so confirm structure after running).
- `generate-deck.js` builds `VWR-Pitch-Deck.pptx` (`node generate-deck.js`, needs `pptxgenjs`); `PITCH_SCRIPT.md` is the matching pitch. These are presentation assets, not part of the runnable app.
