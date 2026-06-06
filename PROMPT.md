# Build Prompt — NYS Virtual Waiting Room (VWR) + In-house Conferencing

> **Goal: reproduce this exact application.** This prompt contains the complete, verbatim source
> of every file. To get an identical result in any CLI (Claude Code, Cursor, Aider, Gemini CLI,
> etc.), follow the instructions below literally.

## HOW TO USE THIS PROMPT (read first)

1. **Reproduce Part 1 verbatim.** Create each file in **PART 1 — EXACT SOURCE FILES** at the
   exact path shown, with the **exact** contents shown. Do **not** paraphrase, reformat, rename,
   re-order, "improve," refactor, or upgrade anything. Copy byte-for-byte.
2. **Do not change dependency versions.** `package.json` pins exact versions on purpose
   (`@nysds/*@1.18.3`, `express@4.22.2`, `socket.io@4.8.3`). Identical NYSDS versions matter —
   the component APIs and the bundled icon set must match.
3. **Then run:**
   ```bash
   npm install
   npm start
   ```
   The app serves at **http://localhost:3000**.
4. **Verify** against the acceptance criteria in **PART 2 — REFERENCE**. Part 2 is explanatory
   context (how/why it works); if Part 2 ever seems to disagree with Part 1, **Part 1 (the
   source) is authoritative.**

## TWO MISTAKES THAT BREAK THE BUILD (do not "fix" these — they are intentional)

- **NYSDS CSS:** `index.html` loads the **tokens** build `/nysds/styles/nysds.min.css`. Do NOT
  switch it to `nysds-full.min.css` — the full build's global element reset destroys the layout.
- **NYSDS components:** `index.html` loads the **UMD** build `/nysds/components/nysds.js` as a
  classic `<script defer>`. Do NOT switch it to the ESM `nysds.es.js` with `type="module"` — that
  build has bare `import ... from "lit"` specifiers the browser can't resolve, so it silently
  fails and **no `nys-*` element renders** (the login button disappears).

These two lines in `index.html` are correct as written. Reproduce them exactly.

---

# PART 1 — EXACT SOURCE FILES (reproduce verbatim)

Create each file at the path in its heading, with the exact contents in the code block.

## `package.json`

```json
{
  "name": "nys-virtual-waiting-room",
  "version": "1.0.0",
  "description": "NYS ITS Virtual Waiting Room (VWR) — manages flow, attendance, and waiting time for Parties of Interest in virtual fair hearings.",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "keywords": [
    "nys",
    "its",
    "virtual-hearing",
    "waiting-room",
    "cisco-webex",
    "fair-hearing"
  ],
  "author": "Hackathon Team",
  "license": "MIT",
  "dependencies": {
    "@nysds/components": "1.18.3",
    "@nysds/styles": "1.18.3",
    "express": "4.22.2",
    "socket.io": "4.8.3"
  }
}
```

## `server.js`

```js
/**
 * NYS ITS — Virtual Waiting Room (VWR)
 * ------------------------------------
 * Self-contained demo backend.
 *
 *  - Express serves the SPA + a small REST surface.
 *  - Socket.io pushes a live state snapshot to every connected client on any change.
 *  - In-memory data store (seeded) so the demo runs with zero external setup.
 *
 * The pieces that would integrate with real NYS systems in production are
 * stubbed and clearly marked with [INTEGRATION] so reviewers can see the seams:
 *   - ITS IAM (SAML2 / OAuth / OIDC) for AuthN/AuthZ + SSO  ->  /api/login
 *   - IES source-of-truth for hearing & participant data    ->  seedData()
 *   - Cisco WebEx / CMR conferencing launch                 ->  startHearing()
 *   - IES write-back of status / officer / participants     ->  pushToIES()
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const ai = require('./ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve the New York State Design System (NYSDS) assets from node_modules.
app.use('/nysds/styles', express.static(path.join(__dirname, 'node_modules/@nysds/styles/dist')));
app.use('/nysds/components', express.static(path.join(__dirname, 'node_modules/@nysds/components/dist')));

// Recordings store (demo-grade local disk; production would be NYS object storage).
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);
app.use('/recordings', express.static(RECORDINGS_DIR));

const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ *
 * Reference data — roles & status vocabularies (mirror the spec)
 * ------------------------------------------------------------------ */

const ROLES = {
  appellant:          { label: 'Appellant',                group: 'party',      multiHearing: true  },
  appellant_rep:      { label: 'Appellant Representative',  group: 'party',      multiHearing: true  },
  appellant_witness:  { label: 'Appellant Witness',         group: 'party',      multiHearing: true  },
  agency_rep:         { label: 'Agency Representative',      group: 'party',      multiHearing: true  },
  agency_witness:     { label: 'Agency Witness',            group: 'party',      multiHearing: true  },
  interpreter:        { label: 'Interpreter',               group: 'support',    multiHearing: true  },
  hearing_officer:    { label: 'Hearing Officer (ALJ)',     group: 'officer',    multiHearing: false },
  admin_staff:        { label: 'Administrative Staff',      group: 'oversight',  multiHearing: true  },
  supervisor:         { label: 'Supervisor / Clerk',        group: 'oversight',  multiHearing: true  },
};

// Waiting-room status lifecycle (spec §9)
const WR_STATUS = {
  NOT_CHECKED_IN: 'not_checked_in',
  NOT_READY:      'not_ready',
  READY:          'ready',
  CALLED:         'called',
  RECALLED:       'recalled',
  CLOSED:         'closed',
};

// Officer-controlled statuses are "sticky" — they are not recomputed from check-ins.
const STICKY = new Set([WR_STATUS.CALLED, WR_STATUS.RECALLED, WR_STATUS.CLOSED]);

/* ------------------------------------------------------------------ *
 * In-memory store
 * ------------------------------------------------------------------ */

let hearings = [];           // the live working set for "today"
const auditLog = [];         // spec §11 — auditing
let nextEventId = 1;

function audit(action, detail, actor) {
  auditLog.unshift({
    id: nextEventId++,
    ts: new Date().toISOString(),
    actor: actor || 'system',
    action,
    detail,
  });
  if (auditLog.length > 500) auditLog.pop();
}

/* ------------------------------------------------------------------ *
 * [INTEGRATION] IES seed — in production this is pulled from the IES
 * source-of-truth fair-hearing systems over a secure REST/webservice API.
 * ------------------------------------------------------------------ */

function seedData() {
  const today = new Date().toISOString().slice(0, 10);

  const mk = (id, p) => ({
    id,
    hearingNumber: p.hearingNumber,
    hearingType: p.hearingType,
    categoryOfAid: p.categoryOfAid,
    agency: p.agency,
    hearingDate: today,
    scheduledTime: p.scheduledTime,
    appellantName: p.appellantName,
    assignedOfficerId: p.assignedOfficerId || null,
    status: WR_STATUS.NOT_CHECKED_IN,
    disposition: null,
    conferenceUrl: null,
    transcript: [],          // [{ from, role, text, ts }] — from live captions
    summary: null,           // AI/extractive hearing summary
    calledAt: null, startedAt: null, closedAt: null, // for wait-time prediction
    participants: p.participants.map((pp) => ({
      userId: pp.userId,
      name: pp.name,
      role: pp.role,
      required: pp.required !== false, // default required
      checkedIn: false,
      checkInTime: null,
      status: 'unavailable', // available | unavailable
    })),
  });

  hearings = [
    mk('H-1001', {
      hearingNumber: 'FH-2026-0001',
      hearingType: 'Medicaid Fair Hearing',
      categoryOfAid: 'Medical Assistance',
      agency: 'DOH',
      scheduledTime: '09:00',
      appellantName: 'Maria Gonzalez',
      assignedOfficerId: 'alj-burns',
      participants: [
        { userId: 'app-gonzalez', name: 'Maria Gonzalez', role: 'appellant' },
        { userId: 'rep-flores',   name: 'David Flores (Rep)', role: 'appellant_rep' },
        { userId: 'agy-doh-1',    name: 'DOH Caseworker', role: 'agency_rep' },
        { userId: 'alj-burns',    name: 'ALJ Patricia Burns', role: 'hearing_officer' },
        { userId: 'int-es-1',     name: 'Spanish Interpreter', role: 'interpreter', required: true },
      ],
    }),
    mk('H-1002', {
      hearingNumber: 'FH-2026-0002',
      hearingType: 'SNAP Benefits Hearing',
      categoryOfAid: 'Food Assistance (SNAP)',
      agency: 'OTDA',
      scheduledTime: '09:30',
      appellantName: 'James Whitfield',
      assignedOfficerId: 'alj-burns',
      participants: [
        { userId: 'app-whitfield', name: 'James Whitfield', role: 'appellant' },
        { userId: 'agy-otda-1',    name: 'OTDA Representative', role: 'agency_rep' },
        { userId: 'alj-burns',     name: 'ALJ Patricia Burns', role: 'hearing_officer' },
        { userId: 'wit-otda-1',    name: 'Agency Witness', role: 'agency_witness', required: false },
      ],
    }),
    mk('H-1003', {
      hearingNumber: 'FH-2026-0003',
      hearingType: 'Child Care Subsidy',
      categoryOfAid: 'Child Care Assistance',
      agency: 'OCFS',
      scheduledTime: '10:00',
      appellantName: 'Aisha Bello',
      assignedOfficerId: 'alj-chen',
      participants: [
        { userId: 'app-bello',  name: 'Aisha Bello', role: 'appellant' },
        { userId: 'rep-okafor', name: 'Grace Okafor (Rep)', role: 'appellant_rep' },
        { userId: 'agy-ocfs-1', name: 'OCFS Representative', role: 'agency_rep' },
        { userId: 'alj-chen',   name: 'ALJ Robert Chen', role: 'hearing_officer' },
      ],
    }),
    mk('H-1004', {
      hearingNumber: 'FH-2026-0004',
      hearingType: 'Temporary Assistance',
      categoryOfAid: 'Temporary Assistance',
      agency: 'OTDA',
      scheduledTime: '10:30',
      appellantName: 'Robert Klein',
      assignedOfficerId: 'alj-chen',
      participants: [
        { userId: 'app-klein',  name: 'Robert Klein', role: 'appellant' },
        { userId: 'agy-otda-2', name: 'OTDA Representative', role: 'agency_rep' },
        { userId: 'alj-chen',   name: 'ALJ Robert Chen', role: 'hearing_officer' },
      ],
    }),
  ];

  audit('IES_SYNC', `Seeded ${hearings.length} hearings from IES source-of-truth`, 'system');
}
seedData();

/* ------------------------------------------------------------------ *
 * Directory of demo users (would come from ITS IAM on SSO)
 * ------------------------------------------------------------------ */

const directory = [
  { userId: 'app-gonzalez',  name: 'Maria Gonzalez',       role: 'appellant' },
  { userId: 'rep-flores',    name: 'David Flores',          role: 'appellant_rep' },
  { userId: 'app-whitfield', name: 'James Whitfield',       role: 'appellant' },
  { userId: 'rep-okafor',    name: 'Grace Okafor',          role: 'appellant_rep' },
  { userId: 'agy-doh-1',     name: 'DOH Caseworker',        role: 'agency_rep' },
  { userId: 'agy-otda-1',    name: 'OTDA Representative',    role: 'agency_rep' },
  { userId: 'int-es-1',      name: 'Spanish Interpreter',   role: 'interpreter' },
  { userId: 'alj-burns',     name: 'ALJ Patricia Burns',    role: 'hearing_officer' },
  { userId: 'alj-chen',      name: 'ALJ Robert Chen',       role: 'hearing_officer' },
  { userId: 'sup-davis',     name: 'Supervisor Lee Davis',  role: 'supervisor' },
  { userId: 'clerk-ramos',   name: 'Clerk Tina Ramos',      role: 'admin_staff' },
];

/* ------------------------------------------------------------------ *
 * Status engine
 * ------------------------------------------------------------------ */

function requiredParticipants(h) {
  return h.participants.filter((p) => p.required);
}

function isPartyCheckedIn(h) {
  // appellant or their representative present
  return h.participants.some(
    (p) => (p.role === 'appellant' || p.role === 'appellant_rep') && p.checkedIn
  );
}

function recomputeStatus(h) {
  if (STICKY.has(h.status)) return; // officer owns called/recalled/closed

  const anyCheckedIn = h.participants.some((p) => p.checkedIn);
  if (!anyCheckedIn) {
    h.status = WR_STATUS.NOT_CHECKED_IN;
    return;
  }
  // Rule: a hearing is Ready (Call Hearing enabled) as soon as AT LEAST ONE
  // participant is checked in and available.
  const anyAvailable = h.participants.some((p) => p.checkedIn && p.status === 'available');
  h.status = anyAvailable ? WR_STATUS.READY : WR_STATUS.NOT_READY;
}

function recomputeAll() {
  hearings.forEach(recomputeStatus);
}

/* ------------------------------------------------------------------ *
 * [INTEGRATION] Write-back to IES (spec §2.1.5). Stubbed -> audit log.
 * ------------------------------------------------------------------ */

function pushToIES(h, reason) {
  audit('IES_WRITEBACK', `${h.hearingNumber}: ${reason} (status=${h.status}, officer=${h.assignedOfficerId || 'none'})`, 'system');
}

/* ------------------------------------------------------------------ *
 * Snapshot + broadcast
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Predictive wait-times for docket balancing (heuristic, no AI needed)
 * ------------------------------------------------------------------ */

const DEFAULT_DURATION_MIN = 20;

function computePredictions() {
  // Learn average hearing duration from completed hearings; fall back to default.
  const durations = hearings
    .filter((h) => h.startedAt && h.closedAt)
    .map((h) => (new Date(h.closedAt) - new Date(h.startedAt)) / 60000)
    .filter((d) => d > 0 && d < 240);
  const avg = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : DEFAULT_DURATION_MIN;

  const now = Date.now();
  const perHearing = {};
  const officerLoad = {};

  // Group active queue by officer (exclude closed).
  const byOfficer = {};
  hearings.forEach((h) => {
    const o = h.assignedOfficerId || 'unassigned';
    (byOfficer[o] = byOfficer[o] || []).push(h);
    if (h.status !== WR_STATUS.CLOSED) officerLoad[o] = (officerLoad[o] || 0) + 1;
  });

  for (const [officer, list] of Object.entries(byOfficer)) {
    const active = list.find((h) => h.status === WR_STATUS.CALLED || h.status === WR_STATUS.RECALLED);
    const elapsed = active && active.startedAt ? (now - new Date(active.startedAt)) / 60000 : 0;
    let cumulative = active ? Math.max(0, avg - elapsed) : 0; // remaining on the in-progress one
    if (active) perHearing[active.id] = { estimatedWaitMin: 0, inProgress: true, officer };

    list
      .filter((h) => h.status !== WR_STATUS.CLOSED && h !== active)
      .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
      .forEach((h) => {
        perHearing[h.id] = { estimatedWaitMin: Math.round(cumulative), inProgress: false, officer };
        cumulative += avg;
      });
  }

  // Docket-balancing suggestions: move from the busiest officer to the lightest.
  const officers = Object.entries(officerLoad).filter(([o]) => o !== 'unassigned');
  const suggestions = [];
  if (officers.length >= 2) {
    officers.sort((a, b) => b[1] - a[1]);
    const [busy, bN] = officers[0];
    const [light, lN] = officers[officers.length - 1];
    if (bN - lN >= 2) {
      suggestions.push(`Rebalance: ${officerName(busy)} has ${bN} open hearings vs ${officerName(light)} with ${lN}. Consider reassigning one.`);
    }
  }

  return { avgDurationMin: Math.round(avg), perHearing, officerLoad, suggestions, generatedAt: new Date().toISOString() };
}

function snapshot() {
  recomputeAll();
  return {
    hearings,
    auditLog: auditLog.slice(0, 50),
    predictions: computePredictions(),
    serverTime: new Date().toISOString(),
  };
}

function broadcast() {
  io.emit('state', snapshot());
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function findHearing(id) {
  return hearings.find((h) => h.id === id);
}
function findParticipant(h, userId) {
  return h && h.participants.find((p) => p.userId === userId);
}
function officerName(id) {
  const o = directory.find((u) => u.userId === id);
  return o ? o.name : (id || 'Unassigned');
}

// Enforce: a Hearing Officer may attend only ONE active hearing at a time (spec §6b.i)
function officerActiveHearing(officerId) {
  return hearings.find(
    (h) => h.assignedOfficerId === officerId &&
           (h.status === WR_STATUS.CALLED || h.status === WR_STATUS.RECALLED)
  );
}

/* ------------------------------------------------------------------ *
 * In-house conferencing (WebRTC signaling)
 * Socket.io rooms named conf:<hearingId> relay SDP/ICE between peers.
 * This replaces the external Cisco WebEx/CMR launch with a NYS-hosted
 * peer-to-peer mesh conference.
 * ------------------------------------------------------------------ */

function confRoster(hearingId) {
  const room = io.sockets.adapter.rooms.get(`conf:${hearingId}`) || new Set();
  const peers = [];
  room.forEach((cid) => {
    const cs = io.sockets.sockets.get(cid);
    if (cs && cs.data.confUser) peers.push(cs.data.confUser);
  });
  return peers;
}

function leaveConf(socket) {
  const u = socket.data.confUser;
  if (!u) return;
  const room = `conf:${u.hearingId}`;
  socket.to(room).emit('conf:peer-left', { id: socket.id });
  socket.leave(room);
  socket.data.confUser = null;
  audit('CONF_LEAVE', `${u.name} left the conference for ${u.hearingId}`, u.name);
  io.to(room).emit('conf:roster', { peers: confRoster(u.hearingId) });
}

/* ------------------------------------------------------------------ *
 * REST: [INTEGRATION] mock ITS IAM SSO login.
 * Returns a session that mirrors a SAML2/OIDC assertion (sub + role claim).
 * ------------------------------------------------------------------ */

app.get('/api/directory', (req, res) => {
  res.json({ directory, roles: ROLES, aiEnabled: ai.HAS_AI });
});

app.post('/api/login', (req, res) => {
  const { userId } = req.body || {};
  const user = directory.find((u) => u.userId === userId);
  if (!user) return res.status(404).json({ error: 'Unknown user' });

  // Simulated assertion. In production these claims arrive signed from ITS IAM.
  const session = {
    sub: user.userId,
    name: user.name,
    role: user.role,
    roleLabel: ROLES[user.role].label,
    issuedAt: new Date().toISOString(),
    issuer: 'mock-its-iam',
  };
  audit('LOGIN', `${user.name} authenticated via SSO as ${ROLES[user.role].label}`, user.name);
  res.json(session);
  broadcast();
});

// Operational reporting endpoint (spec §10)
app.get('/api/report', (req, res) => {
  const counts = {};
  Object.values(WR_STATUS).forEach((s) => (counts[s] = 0));
  hearings.forEach((h) => counts[h.status]++);

  const checkIns = [];
  hearings.forEach((h) =>
    h.participants.forEach((p) => p.checkInTime && checkIns.push(p.checkInTime))
  );

  res.json({
    totalHearings: hearings.length,
    statusCounts: counts,
    totalCheckIns: checkIns.length,
    byAgency: hearings.reduce((acc, h) => {
      acc[h.agency] = (acc[h.agency] || 0) + 1;
      return acc;
    }, {}),
    generatedAt: new Date().toISOString(),
  });
});

// Receive a recording from the host's browser (raw binary body) and save it.
app.post('/api/recordings/:hearingId', express.raw({ type: () => true, limit: '1gb' }), (req, res) => {
  try {
    const safe = String(req.query.name || `${req.params.hearingId}.webm`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = path.join(RECORDINGS_DIR, safe);
    fs.writeFileSync(file, req.body);
    audit('RECORDING_SAVED', `Saved ${safe} (${req.body.length} bytes) for ${req.params.hearingId}`, 'system');
    pushToIES(findHearing(req.params.hearingId) || { hearingNumber: req.params.hearingId }, `recording saved (${safe})`);
    broadcast();
    res.json({ ok: true, file: safe, bytes: req.body.length, url: `/recordings/${safe}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI: translate a caption/snippet (used by the interpreter assist panel).
app.post('/api/ai/translate', async (req, res) => {
  const { text, to } = req.body || {};
  const out = await ai.translate(text || '', to || 'es');
  res.json(out);
});

// AI: translate the whole UI string set for a language (full-interface i18n).
app.post('/api/ai/translate-ui', async (req, res) => {
  const { texts, to } = req.body || {};
  const out = await ai.translateBatch(texts || [], to || 'en');
  res.json(out);
});

// AI: generate a hearing summary for the judge from the transcript.
app.post('/api/ai/summarize', async (req, res) => {
  const h = findHearing((req.body || {}).hearingId);
  if (!h) return res.status(404).json({ error: 'Unknown hearing' });
  const out = await ai.summarize(h);
  h.summary = out.summary;
  audit('AI_SUMMARY', `Summary generated for ${h.hearingNumber} (${out.provider})`, (req.body && req.body.actor) || 'system');
  broadcast();
  res.json(out);
});

// Predictive wait-times for docket balancing.
app.get('/api/predictions', (req, res) => res.json(computePredictions()));

// List saved recordings.
app.get('/api/recordings', (req, res) => {
  try {
    const files = fs.readdirSync(RECORDINGS_DIR)
      .filter((f) => !f.startsWith('.'))
      .map((f) => {
        const st = fs.statSync(path.join(RECORDINGS_DIR, f));
        return { file: f, bytes: st.size, savedAt: st.mtime.toISOString(), url: `/recordings/${f}` };
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    res.json({ recordings: files });
  } catch (e) {
    res.json({ recordings: [] });
  }
});

/* ------------------------------------------------------------------ *
 * Socket.io — real-time actions
 * ------------------------------------------------------------------ */

io.on('connection', (socket) => {
  socket.emit('state', snapshot());

  const actor = () => socket.data.user?.name || 'unknown';

  socket.on('identify', (user) => {
    socket.data.user = user;
  });

  // --- Party / support: check in ---
  socket.on('checkin', ({ hearingId, userId }) => {
    const h = findHearing(hearingId);
    const p = findParticipant(h, userId);
    if (!h || !p) return;
    if (!p.checkedIn) {
      p.checkedIn = true;
      p.checkInTime = new Date().toISOString();
      p.status = 'available';
      audit('CHECK_IN', `${p.name} checked into ${h.hearingNumber}`, actor());
    }
    recomputeStatus(h);
    pushToIES(h, 'participant check-in');
    broadcast();
  });

  // --- Check out ---
  socket.on('checkout', ({ hearingId, userId }) => {
    const h = findHearing(hearingId);
    const p = findParticipant(h, userId);
    if (!h || !p) return;
    p.checkedIn = false;
    p.checkInTime = null;
    p.status = 'unavailable';
    audit('CHECK_OUT', `${p.name} checked out of ${h.hearingNumber}`, actor());
    recomputeStatus(h);
    broadcast();
  });

  // --- Toggle availability (Available / Unavailable) ---
  socket.on('setAvailability', ({ hearingId, userId, status }) => {
    const h = findHearing(hearingId);
    const p = findParticipant(h, userId);
    if (!h || !p || !p.checkedIn) return;
    p.status = status === 'available' ? 'available' : 'unavailable';
    audit('AVAILABILITY', `${p.name} is now ${p.status} for ${h.hearingNumber}`, actor());
    recomputeStatus(h);
    broadcast();
  });

  // --- Hearing Officer: call a participant/hearing into conference ---
  socket.on('call', ({ hearingId, officerId, recall }) => {
    const h = findHearing(hearingId);
    if (!h) return;
    // one-at-a-time enforcement
    const active = officerActiveHearing(officerId);
    if (active && active.id !== h.id) {
      socket.emit('toast', {
        type: 'error',
        msg: `You are already in ${active.hearingNumber}. Close it before calling another.`,
      });
      return;
    }
    h.status = recall ? WR_STATUS.RECALLED : WR_STATUS.CALLED;
    if (!h.calledAt) h.calledAt = new Date().toISOString();
    audit(recall ? 'RECALL' : 'CALL', `${h.hearingNumber} ${recall ? 'recalled' : 'called'} by officer`, actor());
    pushToIES(h, recall ? 'recall' : 'call');
    broadcast();
  });

  // --- Hearing Officer: deny / remove a participant ---
  socket.on('deny', ({ hearingId, userId }) => {
    const h = findHearing(hearingId);
    const p = findParticipant(h, userId);
    if (!h || !p) return;
    p.checkedIn = false;
    p.status = 'unavailable';
    p.denied = true;
    audit('DENY', `${p.name} denied/removed from ${h.hearingNumber}`, actor());
    recomputeStatus(h);
    broadcast();
  });

  // --- Hearing Officer: start the hearing (launch conference) ---
  socket.on('startHearing', ({ hearingId }) => {
    const h = findHearing(hearingId);
    if (!h) return;
    // [INTEGRATION] Cisco WebEx / CMR conference would be provisioned here.
    h.conferenceUrl = `https://nysits.webex.example/meet/${h.id.toLowerCase()}`;
    if (!h.startedAt) h.startedAt = new Date().toISOString();
    if (h.status === WR_STATUS.READY) h.status = WR_STATUS.CALLED;
    audit('START_HEARING', `Conference launched for ${h.hearingNumber}`, actor());
    pushToIES(h, 'conference launched');
    broadcast();
  });

  // --- Hearing Officer: reassign to another officer ---
  socket.on('reassign', ({ hearingId, newOfficerId }) => {
    const h = findHearing(hearingId);
    const officer = directory.find((u) => u.userId === newOfficerId && u.role === 'hearing_officer');
    if (!h || !officer) return;
    h.assignedOfficerId = newOfficerId;
    // drop any previously-assigned officer from the participant list…
    h.participants = h.participants.filter(
      (p) => p.role !== 'hearing_officer' || p.userId === newOfficerId
    );
    // …and add the new officer if not already present
    if (!findParticipant(h, newOfficerId)) {
      h.participants.push({
        userId: officer.userId, name: officer.name, role: 'hearing_officer',
        required: true, checkedIn: false, checkInTime: null, status: 'unavailable',
      });
    }
    audit('REASSIGN', `${h.hearingNumber} reassigned to ${officer.name}`, actor());
    pushToIES(h, 'officer reassigned');
    broadcast();
  });

  // --- Hearing Officer: close hearing / waiting room ---
  socket.on('closeHearing', ({ hearingId, disposition }) => {
    const h = findHearing(hearingId);
    if (!h) return;
    h.status = WR_STATUS.CLOSED;
    h.disposition = disposition || 'Completed';
    h.conferenceUrl = null;
    h.closedAt = new Date().toISOString();
    audit('CLOSE', `${h.hearingNumber} closed (${h.disposition})`, actor());
    pushToIES(h, 'hearing closed');
    broadcast();
  });

  // --- Hearing Officer: recall a closed hearing back into the VWR ---
  socket.on('reopen', ({ hearingId }) => {
    const h = findHearing(hearingId);
    if (!h) return;
    h.status = WR_STATUS.RECALLED;
    h.disposition = null;
    audit('REOPEN', `${h.hearingNumber} recalled after close`, actor());
    pushToIES(h, 'hearing reopened/recalled');
    broadcast();
  });

  // --- Demo convenience: reset everything ---
  socket.on('resetDemo', () => {
    seedData();
    audit('RESET', 'Demo data reset', actor());
    broadcast();
  });

  /* ---------------- In-house conference signaling ---------------- */

  // Join a hearing's conference room. Reply to the newcomer with the list of
  // existing peers (the newcomer initiates offers to each); notify the room.
  socket.on('conf:join', ({ hearingId, user }) => {
    const room = `conf:${hearingId}`;
    const existing = confRoster(hearingId);
    socket.data.confUser = { id: socket.id, name: user.name, role: user.role, sub: user.sub, hearingId };
    socket.join(room);
    socket.emit('conf:peers', { peers: existing });
    socket.to(room).emit('conf:peer-joined', socket.data.confUser);
    io.to(room).emit('conf:roster', { peers: confRoster(hearingId) });
    audit('CONF_JOIN', `${user.name} joined the conference for ${hearingId}`, user.name);
  });

  // Relay an SDP offer/answer or ICE candidate to one specific peer.
  socket.on('conf:signal', ({ to, data }) => {
    io.to(to).emit('conf:signal', { from: socket.id, data, user: socket.data.confUser });
  });

  socket.on('conf:leave', () => leaveConf(socket));

  socket.on('conf:chat', ({ hearingId, text }) => {
    const u = socket.data.confUser;
    if (!u || !text) return;
    io.to(`conf:${hearingId}`).emit('conf:chat', {
      from: u.name, role: u.role, text: String(text).slice(0, 500), ts: new Date().toISOString(),
    });
  });

  // Host (ALJ) controls — target is a peer socket id.
  socket.on('conf:host-mute', ({ target }) => {
    io.to(target).emit('conf:force-mute');
    audit('CONF_HOST_MUTE', `Host muted a participant`, actor());
  });
  socket.on('conf:host-remove', ({ target }) => {
    io.to(target).emit('conf:force-remove');
    audit('CONF_HOST_REMOVE', `Host removed a participant`, actor());
  });

  // Recording presence indicator (spec — record "Presence").
  socket.on('conf:rec', ({ hearingId, on }) => {
    io.to(`conf:${hearingId}`).emit('conf:rec', { on: !!on });
    audit('CONF_REC', `Recording ${on ? 'started' : 'stopped'} for ${hearingId}`, actor());
  });

  // Live captions (browser Web Speech API). Broadcast to the room; on final
  // results, append to the hearing transcript (used for AI summaries).
  socket.on('conf:caption', ({ hearingId, text, final }) => {
    const u = socket.data.confUser;
    if (!u || !text) return;
    const payload = { id: u.id, from: u.name, role: u.role, text: String(text).slice(0, 500), final: !!final, ts: new Date().toISOString() };
    io.to(`conf:${hearingId}`).emit('conf:caption', payload);
    if (final) {
      const h = findHearing(hearingId);
      if (h) {
        h.transcript.push({ from: payload.from, role: payload.role, text: payload.text, ts: payload.ts });
        if (h.transcript.length > 1000) h.transcript.shift();
      }
    }
  });

  socket.on('disconnect', () => leaveConf(socket));
});

server.listen(PORT, () => {
  console.log(`\n  NYS Virtual Waiting Room running at  http://localhost:${PORT}`);
  console.log(`  AI features: ${ai.HAS_AI ? 'Anthropic (live)' : 'demo fallback (set ANTHROPIC_API_KEY for real AI)'}`);
  if (ai.HAS_AI && typeof fetch !== 'function') {
    console.warn('  [warn] ANTHROPIC_API_KEY is set but global fetch is unavailable — upgrade to Node 18+ for AI calls.');
  }
  console.log('');
});
```

## `ai.js`

````js
/**
 * AI services for the VWR — provider-optional.
 *
 * If ANTHROPIC_API_KEY is set, translation and summaries use the Anthropic API
 * (real AI). Otherwise they fall back to deterministic, offline behavior so the
 * demo still works with zero configuration. Live captions are produced in the
 * browser (Web Speech API); this module handles translation + summaries.
 *
 * No SDK dependency — uses the global fetch in Node 18+.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const HAS_AI = !!API_KEY;

async function callClaude(system, user, maxTokens = 600) {
  if (!HAS_AI) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content || []).map((b) => b.text || '').join('').trim() || null;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Translation
 * ------------------------------------------------------------------ */

const LANGS = { en: 'English', es: 'Spanish', fr: 'French', zh: 'Chinese', ru: 'Russian', ar: 'Arabic', bn: 'Bengali', ht: 'Haitian Creole' };

// Tiny offline phrase map for the demo fallback (EN <-> ES), lowercase keys.
const DEMO_DICT = {
  es: {
    'hello': 'hola', 'good morning': 'buenos días', 'good afternoon': 'buenas tardes',
    'please': 'por favor', 'thank you': 'gracias', 'yes': 'sí', 'no': 'no',
    'the hearing will begin shortly': 'la audiencia comenzará en breve',
    'please state your name': 'por favor diga su nombre',
    'can you hear me': '¿puede oírme?', 'do you understand': '¿entiende usted?',
    'are you ready': '¿está usted listo?', 'the hearing is now in session': 'la audiencia está ahora en sesión',
    'please wait': 'por favor espere', 'we are ready': 'estamos listos',
  },
  en: {
    'hola': 'hello', 'buenos días': 'good morning', 'gracias': 'thank you',
    'sí': 'yes', 'no': 'no', 'por favor': 'please', 'estoy listo': 'i am ready',
    '¿puede oírme?': 'can you hear me?', 'no entiendo': 'i do not understand',
  },
};

function demoTranslate(text, to) {
  const dict = DEMO_DICT[to] || {};
  const key = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (dict[key]) return dict[key];
  // word-by-word best effort, else echo with a tag
  const words = key.split(/\s+/).map((w) => dict[w] || w);
  const guess = words.join(' ');
  return guess === key ? `${text}  ⟨${(LANGS[to] || to)} — demo⟩` : guess;
}

async function translate(text, to = 'es') {
  if (!text) return { translation: '', provider: 'none' };
  const ai = await callClaude(
    `You are a real-time court-interpreter translation engine. Translate the user's text into ${LANGS[to] || to}. Output ONLY the translation, no quotes or notes.`,
    text, 300
  );
  if (ai) return { translation: ai, provider: 'anthropic' };
  return { translation: demoTranslate(text, to), provider: 'demo' };
}

/* ------------------------------------------------------------------ *
 * Hearing summary
 * ------------------------------------------------------------------ */

function transcriptText(transcript) {
  return (transcript || []).map((t) => `${t.from} (${t.role}): ${t.text}`).join('\n');
}

async function summarize(hearing) {
  const t = hearing.transcript || [];
  const meta =
    `Hearing ${hearing.hearingNumber} — ${hearing.hearingType} (${hearing.agency}). ` +
    `Appellant: ${hearing.appellantName}. Category of aid: ${hearing.categoryOfAid}. ` +
    `Disposition: ${hearing.disposition || 'n/a'}.`;
  const body = transcriptText(t);

  const ai = await callClaude(
    'You are an assistant to a New York State Administrative Law Judge. Produce a concise, neutral hearing summary in Markdown with these sections: **Issue on Appeal**, **Parties Present**, **Key Points**, **Next Steps**. Base it ONLY on the transcript and metadata; do not invent facts. If the transcript is sparse, say so.',
    `${meta}\n\nTranscript:\n${body || '(no transcript captured)'}`,
    700
  );
  if (ai) return { summary: ai, provider: 'anthropic' };

  // Deterministic extractive fallback
  const speakers = [...new Set(t.map((x) => `${x.from} (${x.role})`))];
  const head = t.slice(0, 3).map((x) => `- ${x.from}: ${x.text}`);
  const tail = t.slice(-3).map((x) => `- ${x.from}: ${x.text}`);
  const lines = [
    `### Hearing Summary — ${hearing.hearingNumber} (auto-generated)`,
    '',
    `**Issue on Appeal:** ${hearing.hearingType} — ${hearing.categoryOfAid} (${hearing.agency}).`,
    `**Parties Present:** ${speakers.length ? speakers.join(', ') : 'No transcript captured.'}`,
    `**Disposition:** ${hearing.disposition || 'Not recorded.'}`,
    '',
    '**Key Points:**',
    ...(head.length ? head : ['- (no statements transcribed)']),
    ...(t.length > 6 ? ['- …', ...tail] : []),
    '',
    '_Extractive summary. Set ANTHROPIC_API_KEY for an AI-generated summary._',
  ];
  return { summary: lines.join('\n'), provider: 'demo' };
}

/* ------------------------------------------------------------------ *
 * Batch UI translation (for full-interface localization)
 * ------------------------------------------------------------------ */

async function translateBatch(texts, to) {
  if (!Array.isArray(texts) || !texts.length || to === 'en') {
    return { translations: texts || [], provider: 'none' };
  }
  if (HAS_AI) {
    const out = await callClaude(
      `You are a professional UI localizer for a New York State government web application about legal "fair hearings". Translate each string in the JSON array into ${LANGS[to] || to}. ` +
        'Keep any placeholder tokens in curly braces (e.g. {time}, {m}, {info}) EXACTLY as-is. Use a clear, formal, respectful register suitable for the public. ' +
        'Return ONLY a JSON array of translated strings, same length and order, no commentary.',
      JSON.stringify(texts), 3000
    );
    if (out) {
      try {
        const arr = JSON.parse(out.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
        if (Array.isArray(arr) && arr.length === texts.length) {
          return { translations: arr.map(String), provider: 'anthropic' };
        }
      } catch (_) { /* fall through */ }
    }
  }
  // No key (or parse failure): keep English so the UI stays clean and readable.
  return { translations: texts, provider: 'fallback-en' };
}

module.exports = { translate, translateBatch, summarize, LANGS, HAS_AI };
````

## `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NYS Virtual Waiting Room</title>
  <!-- New York State Design System (NYSDS) — design tokens + web components.
       We load the TOKENS build (variables/themes), NOT the "full" build: the
       full build resets every raw element (*, body, h1-3, a, table…) and fights
       the custom dashboard layout. Tokens give us official colors/fonts/theming
       for the components and our own CSS, with no global overrides. -->
  <link rel="stylesheet" href="/nysds/styles/nysds.min.css" />
  <!-- Self-contained UMD build (bundles Lit). The ESM build uses bare "lit"
       imports the browser can't resolve without a bundler, so use the UMD one. -->
  <script defer src="/nysds/components/nysds.js"></script>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <!-- Global language selector (globe), top-left, on every screen -->
  <div id="lang-widget" class="lang-widget">
    <button id="lang-btn" class="lang-btn" type="button" aria-haspopup="true" aria-expanded="false" data-i18n-title="lang.select" title="Select language">
      <nys-icon name="language" size="sm" aria-hidden="true"></nys-icon>
      <span id="lang-current">English</span>
      <nys-icon name="chevron_down" size="xs" aria-hidden="true"></nys-icon>
    </button>
    <ul id="lang-menu" class="lang-menu hidden" role="menu" aria-label="Language"></ul>
  </div>

  <!-- ============ LOGIN ============ -->
  <section id="login" class="login-screen" aria-labelledby="login-title">
    <div class="login-card">
      <div class="seal" aria-hidden="true">NYS</div>
      <h1 id="login-title" data-i18n="app.title">Virtual Waiting Room</h1>
      <p class="login-sub" data-i18n="login.subtitle">NYS ITS · Integrated Eligibility System (IES) · Fair Hearings</p>

      <label for="user-select" class="field-label" data-i18n="login.signinVia">Sign in via ITS Identity (SSO)</label>
      <select id="user-select" class="select" aria-describedby="login-hint"></select>
      <p id="login-hint" class="hint" data-i18n="login.hint">Demo SSO — your role &amp; permissions are derived from the IAM assertion.</p>

      <nys-button id="login-btn" fullWidth label="Sign In via SSO" data-i18n-label="login.signin" prefixIcon="lock_filled"></nys-button>

      <details class="sso-note">
        <summary data-i18n="login.aboutAuth">About authentication</summary>
        <p data-i18n="login.aboutBody">In production this screen is replaced by ITS IAM using SAML 2.0 / OAuth / OpenID Connect single sign-on. Role and party-of-interest claims flow from the calling IES application.</p>
      </details>
    </div>
  </section>

  <!-- ============ APP SHELL ============ -->
  <div id="app" class="app hidden">
    <!-- Official NYS agency header (single, clean branding bar) -->
    <nys-globalheader
      appName="Virtual Waiting Room"
      agencyName="Integrated Eligibility System · OTDA · DOH · OCFS"
      homepageLink="#"
      nysLogo></nys-globalheader>

    <header class="topbar" role="banner">
      <div class="topbar-status">
        <span id="conn-status" class="conn" title="Live connection">● Live</span>
        <span id="clock" class="clock" aria-live="off"></span>
      </div>
      <div class="topbar-right">
        <div class="who">
          <span id="who-name" class="who-name"></span>
          <span id="who-role" class="badge badge-role"></span>
        </div>
        <nys-button id="reset-btn" variant="outline" inverted size="sm" label="Reset" data-i18n-label="nav.reset" prefixIcon="refresh" title="Reset demo data"></nys-button>
        <nys-button id="logout-btn" variant="outline" inverted size="sm" label="Sign out" data-i18n-label="nav.signout" prefixIcon="close"></nys-button>
      </div>
    </header>

    <main id="main" class="content" role="main">
      <!-- Toolbar: search + sort (spec §3, §4) -->
      <div id="toolbar" class="toolbar">
        <div class="toolbar-left">
          <div class="search-wrap">
            <nys-icon name="search" size="sm" class="search-icon" aria-hidden="true"></nys-icon>
            <input id="search" class="input has-icon" type="search" data-i18n-ph="toolbar.search" placeholder="Search hearing #, name, type, agency…" aria-label="Search hearings" />
          </div>
          <select id="sort" class="select select-sm" aria-label="Sort hearings">
            <option value="time" data-i18n="sort.time">Sort: Scheduled time</option>
            <option value="appellant" data-i18n="sort.appellant">Sort: Appellant name</option>
            <option value="status" data-i18n="sort.status">Sort: Waiting room status</option>
            <option value="agency" data-i18n="sort.agency">Sort: Agency</option>
          </select>
          <select id="filter-status" class="select select-sm" aria-label="Filter by status">
            <option value="" data-i18n="filter.all">All statuses</option>
          </select>
        </div>
        <div id="view-title" class="view-title"></div>
      </div>

      <div id="board" class="board" aria-live="polite"></div>
    </main>

    <!-- Audit / reporting drawer (spec §10, §11) -->
    <aside id="audit-drawer" class="audit-drawer collapsed" aria-label="Audit and activity log">
      <button id="audit-toggle" class="audit-toggle" aria-expanded="false">Activity &amp; Audit Log</button>
      <div class="audit-body">
        <div id="report-strip" class="report-strip"></div>
        <ul id="audit-list" class="audit-list"></ul>
      </div>
    </aside>
  </div>

  <!-- ============ IN-HOUSE CONFERENCE OVERLAY ============ -->
  <div id="conf" class="conf hidden" role="dialog" aria-label="Virtual hearing conference">
    <div class="conf-bar conf-top">
      <div class="conf-title" id="conf-title"></div>
      <div class="conf-top-right">
        <span id="conf-rec" class="rec hidden" aria-live="polite">● REC</span>
        <span id="conf-count" class="conf-count"></span>
        <span class="conf-brand">NYS IES · In-house Conferencing</span>
      </div>
    </div>

    <div class="conf-main">
      <div class="conf-stage-wrap">
        <div class="conf-stage" id="conf-stage" aria-label="Participant video"></div>

        <!-- Live captions / interpreter translation overlay -->
        <div id="conf-captions" class="conf-captions hidden" aria-live="polite">
          <div class="cap-line" id="cap-original"></div>
          <div class="cap-line cap-translated hidden" id="cap-translated"></div>
        </div>
      </div>

      <aside id="conf-chat" class="conf-chat hidden" aria-label="In-hearing chat">
        <div class="conf-chat-head">In-hearing Chat</div>
        <ul class="conf-chat-msgs" id="conf-chat-msgs"></ul>
        <form class="conf-chat-form" id="conf-chat-form">
          <input id="conf-chat-input" class="input" placeholder="Type a message…" autocomplete="off" aria-label="Chat message" />
          <button class="btn btn-primary btn-sm" type="submit">Send</button>
        </form>
      </aside>
    </div>

    <div class="conf-bar conf-controls">
      <button id="c-mic" class="cbtn" type="button"><span>Mute</span></button>
      <button id="c-cam" class="cbtn" type="button"><span>Stop Video</span></button>
      <button id="c-share" class="cbtn" type="button"><span>Share</span></button>
      <button id="c-cc" class="cbtn" type="button" title="Live captions"><span>Captions</span></button>
      <select id="cap-lang" class="cap-lang" title="Translate captions to…" aria-label="Caption language">
        <option value="">No translation</option>
        <option value="es">Spanish</option>
        <option value="en">English</option>
        <option value="fr">French</option>
        <option value="zh">Chinese</option>
        <option value="ru">Russian</option>
        <option value="ht">Haitian Creole</option>
      </select>
      <button id="c-chat" class="cbtn" type="button"><span>Chat</span></button>
      <button id="c-rec" class="cbtn hidden" type="button"><span>Record</span></button>
      <button id="c-leave" class="cbtn cbtn-leave" type="button"><span>Leave</span></button>
    </div>
  </div>

  <!-- Toast container -->
  <div id="toasts" class="toasts" aria-live="assertive"></div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="i18n.js"></script>
  <script src="app.js"></script>
  <script src="conference.js"></script>
</body>
</html>
```

## `public/styles.css`

```css
/* NYS Virtual Waiting Room — styling
   NYS branding: deep blue (#154673 / #1a3a5c) + gold accent (#f2b134)
   Built for WCAG/508: focus rings, contrast, skip link, semantic colors. */

:root {
  /* Semantic aliases mapped onto New York State Design System (NYSDS) tokens.
     The whole app inherits the official NYS palette, type, and spacing. */
  --nys-blue: var(--nys-color-theme, #154973);            /* state-blue-700 */
  --nys-blue-dk: var(--nys-color-theme-strong, #0e324f);  /* state-blue-800 */
  --nys-blue-lt: var(--nys-color-theme-mid, #457aa5);     /* state-blue-500 */
  --nys-gold: var(--nys-color-accent, #face00);           /* yellow-400 accent */
  --bg: var(--nys-color-neutral-10, #f6f6f6);
  --card: var(--nys-color-surface, #ffffff);
  --ink: var(--nys-color-text, #1b1b1b);
  --muted: var(--nys-color-text-weak, #4a4d4f);
  --line: var(--nys-color-neutral-100, #d0d0ce);
  --green: var(--nys-color-success, #1a8a36);
  --amber: var(--nys-color-warning-strong, #6a5700);
  --red: var(--nys-color-danger, #d22730);
  --radius: var(--nys-radius-lg, 8px);
  --shadow: 0 1px 3px rgba(16,32,55,.10), 0 4px 16px rgba(16,32,55,.06);
  font-family: var(--nys-font-family-sans, "Proxima Nova", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif);
}

body { font-family: var(--nys-font-family-sans, "Segoe UI", system-ui, sans-serif); }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { font-size: 16px; }
body {
  background: var(--bg); color: var(--ink); line-height: 1.5;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  font-size: .95rem;
}
h1, h2, h3, h4 { line-height: 1.2; margin: 0; }

.hidden { display: none !important; }

/* Focus visibility for accessibility */
:focus-visible { outline: 3px solid var(--nys-gold); outline-offset: 2px; }

.skip-link {
  position: absolute; left: -999px; top: 0; background: var(--nys-gold);
  color: #000; padding: 8px 14px; z-index: 1000; border-radius: 0 0 8px 0; font-weight: 600;
}
.skip-link:focus { left: 0; }

/* ---------- Buttons ---------- */
.btn {
  font: inherit; font-weight: 600; border: 1px solid transparent; cursor: pointer;
  padding: 9px 16px; border-radius: var(--nys-radius-md, 6px); background: #e9eef4; color: var(--ink);
  transition: filter .12s, background .12s; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.btn:hover { filter: brightness(.97); }
.btn-primary { background: var(--nys-blue); color: #fff; }
.btn-primary:hover { background: var(--nys-blue-dk); filter: none; }
.btn-danger { background: var(--red); color: #fff; }
.btn-warn { background: var(--amber); color: #fff; }
.btn-ghost { background: transparent; border-color: var(--line); color: var(--ink); }
.btn-block { width: 100%; }
.btn-sm { padding: 6px 11px; font-size: .85rem; }
.btn-xs { padding: 3px 8px; font-size: .72rem; }
.btn.disabled, .btn:disabled { opacity: .45; cursor: not-allowed; }

.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.btn-toggle { background: #fff; border: none; border-radius: 0; padding: 7px 14px; color: var(--muted); }
.btn-toggle.on { background: var(--nys-blue); color: #fff; }

/* ---------- Inputs ---------- */
.input, .select {
  font: inherit; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px;
  background: #fff; color: var(--ink);
}
.select-sm, .input.select-sm { padding: 7px 10px; font-size: .88rem; }

/* NYSDS icon inside search field */
.search-wrap { position: relative; display: inline-flex; align-items: center; }
.search-wrap .search-icon { position: absolute; left: 10px; color: var(--nys-color-text-weak); pointer-events: none; }
.input.has-icon { padding-left: 34px; }

/* NYSDS web-component sizing helpers */
nys-icon { display: inline-flex; vertical-align: middle; }
nys-skipnav { position: relative; z-index: 1000; }

/* ---------- Login ---------- */
.login-screen {
  min-height: 100vh; display: grid; place-items: center;
  background: linear-gradient(135deg, var(--nys-blue) 0%, var(--nys-blue-dk) 100%);
  padding: 20px;
}
.login-card {
  background: var(--card); width: 100%; max-width: 420px; padding: 34px 30px;
  border-radius: 16px; box-shadow: 0 18px 50px rgba(0,0,0,.3); text-align: center;
}
.seal {
  width: 64px; height: 64px; border-radius: 50%; background: var(--nys-gold);
  color: var(--nys-blue-dk); font-weight: 800; font-size: 1.2rem; letter-spacing: 1px;
  display: grid; place-items: center; margin: 0 auto 14px;
  border: 3px solid var(--nys-blue);
}
.login-card h1 { margin: 0 0 4px; font-size: 1.5rem; color: var(--nys-blue); }
.login-sub { margin: 0 0 22px; color: var(--muted); font-size: .85rem; }
.field-label { display: block; text-align: left; font-weight: 600; font-size: .85rem; margin-bottom: 6px; }
.login-card .select { width: 100%; margin-bottom: 6px; }
.hint { font-size: .76rem; color: var(--muted); text-align: left; margin: 4px 0 18px; }
.sso-note { margin-top: 18px; text-align: left; font-size: .8rem; color: var(--muted); }
.sso-note summary { cursor: pointer; font-weight: 600; color: var(--nys-blue-lt); }
.sso-note p { margin: 8px 0 0; line-height: 1.5; }

/* ---------- App shell ---------- */
.app { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  background: var(--nys-blue); color: #fff; display: flex; align-items: center;
  justify-content: space-between; padding: 10px 20px; gap: 14px; flex-wrap: wrap;
  border-bottom: 4px solid var(--nys-gold);
}
.brand { display: flex; align-items: center; gap: 12px; }
.seal-sm { width: 40px; height: 40px; font-size: .8rem; margin: 0; border-width: 2px; }
.brand-title { font-weight: 700; font-size: 1.05rem; }
.brand-sub { font-size: .72rem; opacity: .8; }
.topbar-status { display: flex; align-items: center; gap: 14px; }

/* Global language selector (globe), fixed top-right */
.lang-widget { position: fixed; top: 10px; right: 14px; left: auto; z-index: 500; }
.lang-btn {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font: inherit; font-size: .85rem; font-weight: 600;
  background: rgba(255,255,255,.16); color: #fff; border: 1px solid rgba(255,255,255,.45);
  border-radius: 999px; padding: 6px 12px; backdrop-filter: blur(2px);
}
.lang-btn:hover { background: rgba(255,255,255,.28); }
.lang-btn:focus-visible { outline: 3px solid var(--nys-gold); outline-offset: 2px; }
.lang-menu {
  position: absolute; top: calc(100% + 6px); right: 0; left: auto; margin: 0; padding: 6px; list-style: none;
  background: #fff; color: var(--ink); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 8px 28px rgba(16,32,55,.22); min-width: 210px; max-height: 70vh; overflow: auto;
}
.lang-menu.hidden { display: none; }
/* Always left-align menu items (incl. Arabic/Urdu native names) */
.lang-menu li { padding: 9px 14px; border-radius: 8px; cursor: pointer; font-size: .92rem; white-space: nowrap; text-align: left; direction: ltr; }
.lang-menu li:hover { background: var(--nys-color-theme-weaker, #eff6fb); }
.lang-menu li[aria-checked="true"] { background: var(--nys-color-theme-weak, #cddde9); color: var(--nys-blue); font-weight: 700; }

/* Keep the globe pinned top-right even when the page is RTL */
[dir="rtl"] .lang-widget { left: auto; right: 14px; }
[dir="rtl"] .lang-menu { left: auto; right: 0; }

/* RTL support (Arabic, Urdu, Yiddish) */
[dir="rtl"] .card-meta, [dir="rtl"] .my-controls, [dir="rtl"] .officer-controls { text-align: right; }
[dir="rtl"] .plist li { direction: rtl; }
[dir="rtl"] .summary-body, [dir="rtl"] .summary-empty { text-align: right; }
.topbar-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
nys-globalheader { display: block; width: 100%; }
.conn { font-size: .8rem; color: #bfe8cf; }
.conn.off { color: #ffc9c2; }
.clock { font-variant-numeric: tabular-nums; font-size: .85rem; opacity: .9; }
.who { display: flex; align-items: center; gap: 8px; }
.who-name { font-weight: 600; font-size: .9rem; }

.badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: .72rem; font-weight: 700; }
.badge.status nys-icon { color: currentColor; }
.plist .picon { color: var(--nys-blue-lt); }
.badge-role { background: var(--nys-gold); color: var(--nys-blue-dk); }

/* ---------- Content ---------- */
.content { flex: 1; padding: 18px 20px 90px; max-width: 1240px; width: 100%; margin: 0 auto; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar-left { display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar #search { min-width: 260px; }
.view-title { font-size: 1.15rem; font-weight: 700; color: var(--nys-blue); }

.empty { text-align: center; color: var(--muted); padding: 60px; background: #fff; border-radius: var(--radius); }

/* ---------- Cards ---------- */
.board-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.card {
  background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 16px; border-left: 5px solid var(--line); display: flex; flex-direction: column; gap: 10px;
}
.card.ready { border-left-color: var(--green); }
.card.not_ready { border-left-color: var(--amber); }
.card.called, .card.recalled { border-left-color: var(--nys-blue-lt); }
.card.closed { border-left-color: #9aa6b2; opacity: .85; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.card-title { font-weight: 700; font-size: 1.05rem; }
.card-sub { font-size: .8rem; color: var(--muted); }
.card-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .82rem; color: var(--ink); }
.card-meta b { color: var(--muted); font-weight: 600; }

.status { color: #fff; }
.st-none { background: #8a96a3; }
.st-notready { background: var(--amber); }
.st-ready { background: var(--green); }
.st-called { background: var(--nys-blue-lt); }
.st-recalled { background: #6d4ca8; }
.st-closed { background: #5e6b7a; }

.my-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line); }
.officer-controls { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line); }
.muted { color: var(--muted); font-size: .82rem; }

.card-participants { font-size: .85rem; }
.plist-title { font-weight: 700; font-size: .78rem; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 6px; }
.plist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.plist li { display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: 8px; padding: 4px 0; }
.plist li.denied { opacity: .5; text-decoration: line-through; }
.pname { font-weight: 600; }
.prole { font-size: .72rem; color: var(--muted); }
.pstat { font-size: .76rem; font-weight: 600; }
.ptime { font-size: .7rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot-green { background: var(--green); }
.dot-amber { background: var(--amber); }
.dot-gray { background: #c2cad3; }
.limited-note { color: var(--muted); font-style: italic; font-size: .82rem; }

.conf-link {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--green); color: #fff; text-decoration: none; border: none; cursor: pointer;
  padding: 9px 14px; border-radius: var(--nys-radius-md, 6px); font-weight: 700; font: inherit; font-weight: 700;
}
.conf-link:hover { background: #176e3e; }

/* ---------- Supervisor table ---------- */
.sup-banner { background: #fff; border-radius: var(--radius); padding: 12px 16px; margin-bottom: 12px; box-shadow: var(--shadow); font-size: .9rem; }
.sup-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); font-size: .86rem; }
.sup-table th { background: var(--nys-blue); color: #fff; text-align: left; padding: 10px 12px; font-size: .76rem; text-transform: uppercase; letter-spacing: .4px; }
.sup-table td { padding: 10px 12px; border-top: 1px solid var(--line); vertical-align: top; }
.sup-table tbody tr:hover { background: #f7f9fc; }
.row-ready { background: #f0faf3; }
.row-called, .row-recalled { background: #f0f6fc; }
.row-closed { color: var(--muted); }

/* ---------- AI features: wait chip, summary, prediction banner ---------- */
.wait-chip {
  display: inline-flex; align-items: center; gap: 4px; font-size: .74rem; font-weight: 700;
  color: var(--nys-blue); background: var(--nys-color-theme-weaker, #eff6fb);
  border: 1px solid var(--nys-color-theme-weak, #cddde9); border-radius: 999px; padding: 2px 9px;
}
.wait-chip.in-progress { color: var(--green); background: #f0faf3; border-color: #bfe8cf; }

.summary-box { border: 1px solid var(--line); border-radius: 8px; margin-top: 4px; overflow: hidden; }
.summary-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--bg); padding: 7px 10px; font-weight: 700; font-size: .82rem; color: var(--nys-blue); }
.summary-body { padding: 10px 12px; font-size: .85rem; line-height: 1.5; max-height: 260px; overflow: auto; }
.summary-body strong { color: var(--nys-blue); }
.summary-empty { padding: 10px 12px; font-size: .8rem; }

.pred-banner { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; background: #fff; border-radius: var(--radius); padding: 10px 14px; margin-bottom: 12px; box-shadow: var(--shadow); font-size: .85rem; }
.pred-suggest { color: var(--amber); font-weight: 600; }

/* ---------- Recordings panel (supervisor) ---------- */
.rec-panel { background: #fff; border-radius: var(--radius); box-shadow: var(--shadow); margin-bottom: 12px; overflow: hidden; }
.rec-panel-head { display: flex; align-items: center; gap: 8px; background: var(--nys-blue); color: #fff; padding: 10px 14px; font-weight: 700; font-size: .9rem; }
.rec-panel-head .btn { margin-left: auto; color: #fff; }
.rec-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; padding: 14px; }
.rec-empty { color: var(--muted); padding: 16px; font-style: italic; grid-column: 1 / -1; }
.rec-item { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--bg); }
.rec-video { width: 100%; aspect-ratio: 16/9; background: #000; display: block; }
.rec-meta { padding: 8px 10px; }
.rec-name { font-size: .78rem; font-weight: 600; word-break: break-all; }
.rec-sub { font-size: .72rem; color: var(--muted); margin: 2px 0 6px; }

/* ---------- Audit drawer ---------- */
.audit-drawer { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid var(--line); box-shadow: 0 -4px 16px rgba(16,32,55,.08); z-index: 50; }
.audit-toggle { width: 100%; border: none; background: var(--nys-blue-dk); color: #fff; padding: 8px; font-weight: 700; cursor: pointer; font-size: .82rem; }
.audit-body { max-height: 42vh; overflow: auto; padding: 12px 16px; }
.audit-drawer.collapsed .audit-body { display: none; }
.report-strip { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.stat { background: var(--bg); border-radius: 8px; padding: 8px 16px; text-align: center; min-width: 80px; }
.stat-n { display: block; font-size: 1.4rem; font-weight: 800; color: var(--nys-blue); }
.stat-l { font-size: .72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
.audit-list { list-style: none; margin: 0; padding: 0; font-size: .8rem; }
.audit-list li { display: flex; gap: 10px; padding: 4px 0; border-bottom: 1px solid #f0f2f5; }
.audit-time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.audit-action { font-weight: 700; color: var(--nys-blue-lt); min-width: 120px; }
.audit-detail { color: var(--ink); }

/* ---------- Toasts ---------- */
.toasts { position: fixed; top: 70px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 200; }
.toast { background: var(--ink); color: #fff; padding: 12px 18px; border-radius: 8px; box-shadow: var(--shadow); opacity: 0; transform: translateX(30px); transition: all .3s; max-width: 320px; }
.toast.show { opacity: 1; transform: translateX(0); }
.toast-error { background: var(--red); }
.toast-info { background: var(--nys-blue); }

/* ---------- In-house conference ---------- */
body.conf-open { overflow: hidden; }
.conf {
  position: fixed; inset: 0; z-index: 300; background: #0d1117; color: #e6edf3;
  display: flex; flex-direction: column;
}
.conf-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #161b22; }
.conf-top { border-bottom: 1px solid #21262d; }
.conf-title { font-weight: 700; font-size: 1rem; }
.conf-top-right { display: flex; align-items: center; gap: 14px; font-size: .82rem; color: #9aa6b2; }
.conf-brand { color: #7d8896; }
.rec { color: #ff5c5c; font-weight: 800; letter-spacing: .5px; animation: blink 1.2s steps(2,start) infinite; }
@keyframes blink { 50% { opacity: .25; } }
.conf-count { background: #21262d; padding: 3px 10px; border-radius: 999px; color: #c9d4df; }

.conf-main { flex: 1; display: flex; min-height: 0; }
.conf-stage-wrap { position: relative; flex: 1; display: flex; min-height: 0; }

/* Live captions / translation overlay */
.conf-captions {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: 14px;
  max-width: min(880px, 92%); width: max-content; z-index: 6;
  background: rgba(0,0,0,.72); color: #fff; border-radius: 10px; padding: 10px 16px;
  text-align: center; pointer-events: none;
}
.cap-line { font-size: 1.05rem; line-height: 1.4; }
.cap-translated { color: var(--nys-gold); font-style: italic; margin-top: 4px; }
.cap-lang {
  font: inherit; font-size: .8rem; background: #21262d; color: #e6edf3;
  border: 1px solid #30363d; border-radius: 8px; padding: 6px 8px; align-self: center;
}
.conf-stage {
  flex: 1; display: grid; gap: 10px; padding: 14px; overflow: auto;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); align-content: start;
}
.tile {
  position: relative; background: #000; border-radius: 12px; overflow: hidden;
  aspect-ratio: 16/9; border: 2px solid #21262d; min-height: 150px;
}
.tile[data-state="connected"] { border-color: #1e8e4e; }
.tile-self { border-color: var(--nys-gold); }
.tile video { width: 100%; height: 100%; object-fit: cover; background: #11161d; }
.tile-self video { transform: scaleX(-1); } /* mirror self-view */
.tile-label {
  position: absolute; left: 8px; bottom: 8px; display: flex; gap: 8px; align-items: center;
  background: rgba(0,0,0,.55); padding: 4px 10px; border-radius: 8px; font-size: .8rem;
}
.tile-name { font-weight: 700; }
.tile-role { color: #9aa6b2; font-size: .72rem; }
.tile-badges { position: absolute; right: 8px; bottom: 8px; }
.tbadge { background: rgba(0,0,0,.55); padding: 3px 8px; border-radius: 8px; font-size: .8rem; }
.tile-host { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity .15s; }
.tile:hover .tile-host { opacity: 1; }
.thbtn { background: rgba(20,70,115,.92); color: #fff; border: none; border-radius: 6px; padding: 5px 10px; font-size: .72rem; font-weight: 700; cursor: pointer; }
.thbtn-rm { background: rgba(192,57,43,.92); }

.conf-chat {
  width: 320px; background: #161b22; border-left: 1px solid #21262d; display: flex; flex-direction: column;
}
.conf-chat-head { padding: 12px 14px; font-weight: 700; border-bottom: 1px solid #21262d; }
.conf-chat-msgs { flex: 1; overflow: auto; list-style: none; margin: 0; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.conf-chat-msgs li { background: #21262d; padding: 8px 10px; border-radius: 10px; font-size: .85rem; }
.conf-chat-msgs li.me { background: #1f3a52; }
.cm-head { display: flex; gap: 6px; align-items: baseline; font-size: .72rem; color: #9aa6b2; margin-bottom: 3px; }
.cm-head b { color: #e6edf3; }
.cm-time { margin-left: auto; }
.cm-text { word-break: break-word; }
.conf-chat-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #21262d; }
.conf-chat-form .input { flex: 1; background: #0d1117; color: #e6edf3; border-color: #30363d; }

.conf-controls { background: #161b22; border-top: 1px solid #21262d; justify-content: center; gap: 10px; }
.cbtn {
  display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 76px;
  background: #21262d; color: #e6edf3; border: none; border-radius: 10px; padding: 10px 12px;
  font-size: 1.2rem; cursor: pointer; transition: background .12s;
}
.cbtn span { font-size: .68rem; font-weight: 600; }
.cic { display: inline-block; vertical-align: middle; }
.cbtn .cic { width: 24px; height: 24px; }
#c-rec .cic { color: #ff5c5c; }            /* record dot always red */
.tbadge { display: inline-flex; align-items: center; gap: 4px; }
.tbadge .cic { width: 16px; height: 16px; }
.thbtn { display: inline-flex; align-items: center; gap: 4px; }
.thbtn .cic { width: 14px; height: 14px; }
.cbtn:hover { background: #2d333b; }
.cbtn.off { background: #5a2222; }            /* mic/cam disabled */
.cbtn.active { background: var(--nys-blue-lt); }  /* share/record active */
.cbtn-leave { background: var(--red); }
.cbtn-leave:hover { background: #a93226; }

@media (max-width: 640px) {
  .conf-chat { position: absolute; right: 0; top: 52px; bottom: 80px; width: 85%; z-index: 5; }
  .cbtn { min-width: 60px; font-size: 1rem; padding: 8px; }
}

/* ---------- Responsive (spec §2.2.2 multi-device) ---------- */
@media (max-width: 640px) {
  .board-cards { grid-template-columns: 1fr; }
  .toolbar { flex-direction: column; align-items: stretch; }
  .toolbar #search { min-width: 0; }
  .plist li { grid-template-columns: auto 1fr; }
  .prole, .ptime { display: none; }
  .sup-table { display: block; overflow-x: auto; }
  .brand-sub { display: none; }
}
```

## `public/i18n.js`

```js
/* Internationalization for the VWR — NYS language-access set (12 languages + English).
 *
 * All languages are baked in so switching is INSTANT and works offline with no API
 * key. English + Spanish are the most thoroughly reviewed; the other 11 cover the
 * core appellant-facing UI (longer/secondary strings fall back to English per key).
 * Production should replace these with NYS's official language-access translations.
 *
 * Usage: VWRi18n.t('key', {vars}). Static HTML uses [data-i18n], [data-i18n-ph],
 * [data-i18n-title], [data-i18n-label]. Call VWRi18n.setLang(code) to switch.
 */
(function () {
  'use strict';

  const LANGS = [
    { code: 'en', name: 'English',        dir: 'ltr' },
    { code: 'es', name: 'Español',        dir: 'ltr' },
    { code: 'zh', name: '中文',            dir: 'ltr' },
    { code: 'ru', name: 'Русский',        dir: 'ltr' },
    { code: 'bn', name: 'বাংলা',          dir: 'ltr' },
    { code: 'ht', name: 'Kreyòl Ayisyen', dir: 'ltr' },
    { code: 'ko', name: '한국어',          dir: 'ltr' },
    { code: 'ar', name: 'العربية',         dir: 'rtl' },
    { code: 'it', name: 'Italiano',       dir: 'ltr' },
    { code: 'pl', name: 'Polski',         dir: 'ltr' },
    { code: 'fr', name: 'Français',       dir: 'ltr' },
    { code: 'ur', name: 'اردو',            dir: 'rtl' },
    { code: 'yi', name: 'ייִדיש',          dir: 'rtl' },
  ];
  const DIR = {};
  LANGS.forEach((l) => (DIR[l.code] = l.dir));

  const STRINGS = {
    en: {
      'app.title': 'Virtual Waiting Room',
      'app.subtitle': 'Integrated Eligibility System · Fair Hearings',
      'login.subtitle': 'NYS ITS · Integrated Eligibility System (IES) · Fair Hearings',
      'login.signinVia': 'Sign in via ITS Identity (SSO)',
      'login.hint': 'Demo SSO — your role & permissions are derived from the IAM assertion.',
      'login.signin': 'Sign In via SSO',
      'login.aboutAuth': 'About authentication',
      'login.aboutBody': 'In production this screen is replaced by ITS IAM using SAML 2.0 / OAuth / OpenID Connect single sign-on. Role and party-of-interest claims flow from the calling IES application.',
      'common.language': 'Language', 'common.empty': 'No hearings match your view.',
      'nav.live': 'Live', 'nav.offline': 'Offline', 'nav.reset': 'Reset', 'nav.signout': 'Sign out',
      'toolbar.search': 'Search hearing #, name, type, agency…',
      'sort.time': 'Sort: Scheduled time', 'sort.appellant': 'Sort: Appellant name',
      'sort.status': 'Sort: Waiting room status', 'sort.agency': 'Sort: Agency',
      'filter.all': 'All statuses',
      'view.my': 'My Hearings', 'view.assigned': 'My Assigned Hearings',
      'view.oversight': 'All Hearings — Oversight Dashboard', 'view.support': 'Hearings I Support',
      'status.not_checked_in': 'Not Checked In', 'status.not_ready': 'Not Ready',
      'status.ready': 'Ready for Hearing', 'status.called': 'Called',
      'status.recalled': 'Recalled', 'status.closed': 'Closed',
      'card.appellant': 'Appellant', 'card.time': 'Time', 'card.aid': 'Aid', 'card.disposition': 'Disposition',
      'card.checkin': 'Check In', 'card.checkout': 'Check Out',
      'card.available': 'Available', 'card.unavailable': 'Unavailable',
      'card.checkedIn': "You're checked in.", 'card.checkedInAt': "You're checked in at {time}.",
      'card.join': 'Join Virtual Hearing (In-house Video)',
      'card.participants': 'Participants', 'card.pNotChecked': 'Not checked in', 'card.removed': 'Removed',
      'card.wait': 'Est. wait ~{m} min', 'card.inProgress': 'In progress',
      'card.closedNote': 'This hearing is closed.',
      'card.limited': 'Participant details are limited for your role.',
      'officer.call': 'Call Hearing', 'officer.start': 'Start / Launch Conference',
      'officer.close': 'Close Hearing', 'officer.recall': 'Recall Hearing',
      'officer.reassign': 'Reassign to…', 'officer.deny': 'Deny',
      'officer.waiting': 'Waiting for at least one participant to check in and be available.',
      'summary.title': 'AI Hearing Summary', 'summary.generate': 'Generate',
      'summary.regenerate': 'Regenerate', 'summary.generating': 'Generating…',
      'summary.empty': 'Generates a structured summary from the transcript ({info}).',
      'role.appellant': 'Appellant', 'role.appellant_rep': 'Appellant Representative',
      'role.appellant_witness': 'Appellant Witness', 'role.agency_rep': 'Agency Representative',
      'role.agency_witness': 'Agency Witness', 'role.interpreter': 'Interpreter',
      'role.hearing_officer': 'Hearing Officer (ALJ)', 'role.admin_staff': 'Administrative Staff',
      'role.supervisor': 'Supervisor / Clerk',
      'lang.select': 'Select language',
    },
    es: {
      'app.title': 'Sala de Espera Virtual',
      'app.subtitle': 'Sistema Integrado de Elegibilidad · Audiencias Imparciales',
      'login.subtitle': 'NYS ITS · Sistema Integrado de Elegibilidad (IES) · Audiencias Imparciales',
      'login.signinVia': 'Inicie sesión con ITS Identity (SSO)',
      'login.hint': 'SSO de demostración: su rol y permisos se derivan de la aserción de IAM.',
      'login.signin': 'Iniciar sesión con SSO',
      'login.aboutAuth': 'Acerca de la autenticación',
      'login.aboutBody': 'En producción, esta pantalla se reemplaza por ITS IAM mediante inicio de sesión único SAML 2.0 / OAuth / OpenID Connect. El rol y las reclamaciones de parte interesada provienen de la aplicación IES.',
      'common.language': 'Idioma', 'common.empty': 'Ninguna audiencia coincide con su vista.',
      'nav.live': 'En vivo', 'nav.offline': 'Sin conexión', 'nav.reset': 'Reiniciar', 'nav.signout': 'Cerrar sesión',
      'toolbar.search': 'Buscar n.º de audiencia, nombre, tipo, agencia…',
      'sort.time': 'Ordenar: Hora programada', 'sort.appellant': 'Ordenar: Nombre del apelante',
      'sort.status': 'Ordenar: Estado de la sala', 'sort.agency': 'Ordenar: Agencia',
      'filter.all': 'Todos los estados',
      'view.my': 'Mis Audiencias', 'view.assigned': 'Mis Audiencias Asignadas',
      'view.oversight': 'Todas las Audiencias — Panel de Supervisión', 'view.support': 'Audiencias que Apoyo',
      'status.not_checked_in': 'Sin Registrar', 'status.not_ready': 'No Listo',
      'status.ready': 'Listo para la Audiencia', 'status.called': 'Llamado',
      'status.recalled': 'Rellamado', 'status.closed': 'Cerrado',
      'card.appellant': 'Apelante', 'card.time': 'Hora', 'card.aid': 'Tipo de Ayuda', 'card.disposition': 'Resolución',
      'card.checkin': 'Registrarse', 'card.checkout': 'Salir',
      'card.available': 'Disponible', 'card.unavailable': 'No Disponible',
      'card.checkedIn': 'Está registrado.', 'card.checkedInAt': 'Está registrado a las {time}.',
      'card.join': 'Unirse a la Audiencia Virtual (Video)',
      'card.participants': 'Participantes', 'card.pNotChecked': 'Sin registrar', 'card.removed': 'Eliminado',
      'card.wait': 'Espera estimada ~{m} min', 'card.inProgress': 'En curso',
      'card.closedNote': 'Esta audiencia está cerrada.',
      'card.limited': 'Los detalles de los participantes son limitados para su rol.',
      'officer.call': 'Llamar a la Audiencia', 'officer.start': 'Iniciar / Abrir Conferencia',
      'officer.close': 'Cerrar Audiencia', 'officer.recall': 'Rellamar Audiencia',
      'officer.reassign': 'Reasignar a…', 'officer.deny': 'Denegar',
      'officer.waiting': 'Esperando a que al menos un participante se registre y esté disponible.',
      'summary.title': 'Resumen de Audiencia con IA', 'summary.generate': 'Generar',
      'summary.regenerate': 'Regenerar', 'summary.generating': 'Generando…',
      'summary.empty': 'Genera un resumen estructurado a partir de la transcripción ({info}).',
      'role.appellant': 'Apelante', 'role.appellant_rep': 'Representante del Apelante',
      'role.appellant_witness': 'Testigo del Apelante', 'role.agency_rep': 'Representante de la Agencia',
      'role.agency_witness': 'Testigo de la Agencia', 'role.interpreter': 'Intérprete',
      'role.hearing_officer': 'Juez de Audiencia (ALJ)', 'role.admin_staff': 'Personal Administrativo',
      'role.supervisor': 'Supervisor / Secretario',
      'lang.select': 'Seleccionar idioma',
    },
    zh: {
      'app.title': '虚拟候审室', 'common.language': '语言', 'common.empty': '没有符合您视图的听证会。',
      'nav.live': '在线', 'nav.offline': '离线', 'nav.reset': '重置', 'nav.signout': '退出',
      'login.signinVia': '通过 ITS Identity (SSO) 登录', 'login.signin': '通过 SSO 登录',
      'view.my': '我的听证会', 'view.assigned': '分配给我的听证会',
      'view.oversight': '所有听证会 — 监督面板', 'view.support': '我支持的听证会',
      'status.not_checked_in': '未签到', 'status.not_ready': '未就绪', 'status.ready': '准备就绪',
      'status.called': '已传唤', 'status.recalled': '重新传唤', 'status.closed': '已结束',
      'card.appellant': '上诉人', 'card.time': '时间', 'card.aid': '援助类型', 'card.disposition': '裁定',
      'card.checkin': '签到', 'card.checkout': '签退', 'card.available': '可参加', 'card.unavailable': '暂不可参加',
      'card.join': '加入虚拟听证会（内置视频）', 'card.participants': '参与者',
      'card.pNotChecked': '未签到', 'card.removed': '已移除', 'card.inProgress': '进行中',
      'card.closedNote': '此听证会已结束。', 'card.checkedIn': '您已签到。', 'card.wait': '预计等待约 {m} 分钟',
      'card.limited': '根据您的角色，参与者详情受到限制。',
      'officer.call': '传唤听证会', 'officer.start': '开始 / 启动会议', 'officer.close': '结束听证会',
      'officer.recall': '重新传唤听证会', 'officer.deny': '拒绝', 'officer.reassign': '重新分配给…',
      'officer.waiting': '正在等待至少一名参与者签到并可参加。',
      'role.appellant': '上诉人', 'role.appellant_rep': '上诉人代表', 'role.appellant_witness': '上诉人证人',
      'role.agency_rep': '机构代表', 'role.agency_witness': '机构证人', 'role.interpreter': '口译员',
      'role.hearing_officer': '听证官 (ALJ)', 'role.admin_staff': '行政人员', 'role.supervisor': '主管 / 书记员',
      'summary.title': 'AI 听证摘要', 'summary.generate': '生成', 'summary.regenerate': '重新生成',
      'filter.all': '所有状态', 'sort.time': '排序：预定时间', 'sort.appellant': '排序：上诉人姓名',
      'sort.status': '排序：候审状态', 'sort.agency': '排序：机构', 'lang.select': '选择语言',
    },
    ru: {
      'app.title': 'Виртуальный зал ожидания', 'common.language': 'Язык', 'common.empty': 'Нет слушаний, соответствующих вашему виду.',
      'nav.live': 'В сети', 'nav.offline': 'Не в сети', 'nav.reset': 'Сброс', 'nav.signout': 'Выйти',
      'login.signinVia': 'Войти через ITS Identity (SSO)', 'login.signin': 'Войти через SSO',
      'view.my': 'Мои слушания', 'view.assigned': 'Назначенные мне слушания',
      'view.oversight': 'Все слушания — Панель надзора', 'view.support': 'Слушания, которые я поддерживаю',
      'status.not_checked_in': 'Не отмечен', 'status.not_ready': 'Не готово', 'status.ready': 'Готово к слушанию',
      'status.called': 'Вызвано', 'status.recalled': 'Повторно вызвано', 'status.closed': 'Закрыто',
      'card.appellant': 'Заявитель', 'card.time': 'Время', 'card.aid': 'Вид помощи', 'card.disposition': 'Решение',
      'card.checkin': 'Отметиться', 'card.checkout': 'Выйти', 'card.available': 'Доступен', 'card.unavailable': 'Недоступен',
      'card.join': 'Присоединиться к виртуальному слушанию (видео)', 'card.participants': 'Участники',
      'card.pNotChecked': 'Не отметился', 'card.removed': 'Удалён', 'card.inProgress': 'Идёт',
      'card.closedNote': 'Это слушание закрыто.', 'card.checkedIn': 'Вы отметились.', 'card.wait': 'Ожидание ~{m} мин',
      'card.limited': 'Сведения об участниках ограничены для вашей роли.',
      'officer.call': 'Вызвать на слушание', 'officer.start': 'Начать / Запустить конференцию', 'officer.close': 'Закрыть слушание',
      'officer.recall': 'Повторно вызвать слушание', 'officer.deny': 'Отклонить', 'officer.reassign': 'Переназначить…',
      'officer.waiting': 'Ожидается, что хотя бы один участник отметится и будет доступен.',
      'role.appellant': 'Заявитель', 'role.appellant_rep': 'Представитель заявителя', 'role.appellant_witness': 'Свидетель заявителя',
      'role.agency_rep': 'Представитель агентства', 'role.agency_witness': 'Свидетель агентства', 'role.interpreter': 'Переводчик',
      'role.hearing_officer': 'Судья (ALJ)', 'role.admin_staff': 'Административный персонал', 'role.supervisor': 'Руководитель / Секретарь',
      'summary.title': 'Резюме слушания (ИИ)', 'summary.generate': 'Создать', 'summary.regenerate': 'Создать заново',
      'filter.all': 'Все статусы', 'sort.time': 'Сортировка: время', 'sort.appellant': 'Сортировка: имя заявителя',
      'sort.status': 'Сортировка: статус', 'sort.agency': 'Сортировка: агентство', 'lang.select': 'Выбрать язык',
    },
    bn: {
      'app.title': 'ভার্চুয়াল ওয়েটিং রুম', 'common.language': 'ভাষা', 'common.empty': 'আপনার ভিউয়ের সাথে মেলে এমন কোনো শুনানি নেই।',
      'nav.live': 'লাইভ', 'nav.offline': 'অফলাইন', 'nav.reset': 'রিসেট', 'nav.signout': 'সাইন আউট',
      'login.signinVia': 'ITS Identity (SSO) দিয়ে সাইন ইন করুন', 'login.signin': 'SSO দিয়ে সাইন ইন',
      'view.my': 'আমার শুনানি', 'view.assigned': 'আমাকে বরাদ্দকৃত শুনানি',
      'view.oversight': 'সকল শুনানি — তত্ত্বাবধান ড্যাশবোর্ড', 'view.support': 'আমি যেসব শুনানিতে সহায়তা করি',
      'status.not_checked_in': 'চেক-ইন হয়নি', 'status.not_ready': 'প্রস্তুত নয়', 'status.ready': 'শুনানির জন্য প্রস্তুত',
      'status.called': 'ডাকা হয়েছে', 'status.recalled': 'পুনরায় ডাকা হয়েছে', 'status.closed': 'বন্ধ',
      'card.appellant': 'আপিলকারী', 'card.time': 'সময়', 'card.aid': 'সহায়তার ধরন', 'card.disposition': 'নিষ্পত্তি',
      'card.checkin': 'চেক ইন', 'card.checkout': 'চেক আউট', 'card.available': 'উপলব্ধ', 'card.unavailable': 'অনুপলব্ধ',
      'card.join': 'ভার্চুয়াল শুনানিতে যোগ দিন (ভিডিও)', 'card.participants': 'অংশগ্রহণকারীরা',
      'card.pNotChecked': 'চেক-ইন হয়নি', 'card.removed': 'অপসারিত', 'card.inProgress': 'চলছে',
      'card.closedNote': 'এই শুনানিটি বন্ধ।', 'card.checkedIn': 'আপনি চেক-ইন করেছেন।', 'card.wait': 'আনুমানিক অপেক্ষা ~{m} মিনিট',
      'card.limited': 'আপনার ভূমিকার জন্য অংশগ্রহণকারীর বিবরণ সীমিত।',
      'officer.call': 'শুনানিতে ডাকুন', 'officer.start': 'শুরু করুন / কনফারেন্স চালু করুন', 'officer.close': 'শুনানি বন্ধ করুন',
      'officer.recall': 'শুনানি পুনরায় ডাকুন', 'officer.deny': 'প্রত্যাখ্যান', 'officer.reassign': 'পুনরায় বরাদ্দ করুন…',
      'officer.waiting': 'অন্তত একজন অংশগ্রহণকারী চেক-ইন ও উপলব্ধ হওয়ার অপেক্ষায়।',
      'role.appellant': 'আপিলকারী', 'role.appellant_rep': 'আপিলকারীর প্রতিনিধি', 'role.appellant_witness': 'আপিলকারীর সাক্ষী',
      'role.agency_rep': 'সংস্থার প্রতিনিধি', 'role.agency_witness': 'সংস্থার সাক্ষী', 'role.interpreter': 'দোভাষী',
      'role.hearing_officer': 'শুনানি কর্মকর্তা (ALJ)', 'role.admin_staff': 'প্রশাসনিক কর্মী', 'role.supervisor': 'সুপারভাইজার / কেরানি',
      'summary.title': 'AI শুনানির সারসংক্ষেপ', 'summary.generate': 'তৈরি করুন', 'summary.regenerate': 'পুনরায় তৈরি করুন',
      'filter.all': 'সব স্ট্যাটাস', 'sort.time': 'সাজান: নির্ধারিত সময়', 'sort.appellant': 'সাজান: আপিলকারীর নাম',
      'sort.status': 'সাজান: স্ট্যাটাস', 'sort.agency': 'সাজান: সংস্থা', 'lang.select': 'ভাষা নির্বাচন করুন',
    },
    ht: {
      'app.title': 'Sal Datant Vityèl', 'common.language': 'Lang', 'common.empty': 'Pa gen odyans ki koresponn ak vi ou.',
      'nav.live': 'Anliy', 'nav.offline': 'Dekonekte', 'nav.reset': 'Reyajiste', 'nav.signout': 'Dekonekte',
      'login.signinVia': 'Konekte ak ITS Identity (SSO)', 'login.signin': 'Konekte ak SSO',
      'view.my': 'Odyans Mwen yo', 'view.assigned': 'Odyans yo Ban Mwen',
      'view.oversight': 'Tout Odyans — Tablo Sipèvizyon', 'view.support': 'Odyans Mwen Sipòte',
      'status.not_checked_in': 'Poko Anrejistre', 'status.not_ready': 'Pa Pare', 'status.ready': 'Pare pou Odyans',
      'status.called': 'Rele', 'status.recalled': 'Rele Ankò', 'status.closed': 'Fèmen',
      'card.appellant': 'Apelan', 'card.time': 'Lè', 'card.aid': 'Kalite Èd', 'card.disposition': 'Desizyon',
      'card.checkin': 'Anrejistre', 'card.checkout': 'Soti', 'card.available': 'Disponib', 'card.unavailable': 'Pa Disponib',
      'card.join': 'Antre nan Odyans Vityèl la (Videyo)', 'card.participants': 'Patisipan yo',
      'card.pNotChecked': 'Poko anrejistre', 'card.removed': 'Retire', 'card.inProgress': 'Ap fèt',
      'card.closedNote': 'Odyans sa a fèmen.', 'card.checkedIn': 'Ou anrejistre.', 'card.wait': 'Tan estime ~{m} min',
      'card.limited': 'Detay patisipan yo limite pou wòl ou.',
      'officer.call': 'Rele Odyans la', 'officer.start': 'Kòmanse / Lanse Konferans', 'officer.close': 'Fèmen Odyans',
      'officer.recall': 'Rele Odyans Ankò', 'officer.deny': 'Refize', 'officer.reassign': 'Reasiyen bay…',
      'officer.waiting': 'N ap tann pou omwen yon patisipan anrejistre epi disponib.',
      'role.appellant': 'Apelan', 'role.appellant_rep': 'Reprezantan Apelan', 'role.appellant_witness': 'Temwen Apelan',
      'role.agency_rep': 'Reprezantan Ajans', 'role.agency_witness': 'Temwen Ajans', 'role.interpreter': 'Entèprèt',
      'role.hearing_officer': 'Jij Odyans (ALJ)', 'role.admin_staff': 'Pèsonèl Administratif', 'role.supervisor': 'Sipèvizè / Grefye',
      'summary.title': 'Rezime Odyans AI', 'summary.generate': 'Jenere', 'summary.regenerate': 'Rejenere',
      'filter.all': 'Tout estati', 'sort.time': 'Klase: Lè pwograme', 'sort.appellant': 'Klase: Non apelan',
      'sort.status': 'Klase: Estati', 'sort.agency': 'Klase: Ajans', 'lang.select': 'Chwazi lang',
    },
    ko: {
      'app.title': '가상 대기실', 'common.language': '언어', 'common.empty': '보기에 해당하는 심리가 없습니다.',
      'nav.live': '실시간', 'nav.offline': '오프라인', 'nav.reset': '초기화', 'nav.signout': '로그아웃',
      'login.signinVia': 'ITS Identity(SSO)로 로그인', 'login.signin': 'SSO로 로그인',
      'view.my': '내 심리', 'view.assigned': '배정된 심리', 'view.oversight': '전체 심리 — 감독 대시보드', 'view.support': '내가 지원하는 심리',
      'status.not_checked_in': '미체크인', 'status.not_ready': '준비 안 됨', 'status.ready': '심리 준비 완료',
      'status.called': '호출됨', 'status.recalled': '재호출됨', 'status.closed': '종료됨',
      'card.appellant': '항소인', 'card.time': '시간', 'card.aid': '지원 유형', 'card.disposition': '처분',
      'card.checkin': '체크인', 'card.checkout': '체크아웃', 'card.available': '참여 가능', 'card.unavailable': '참여 불가',
      'card.join': '가상 심리 참여 (영상)', 'card.participants': '참여자',
      'card.pNotChecked': '미체크인', 'card.removed': '제거됨', 'card.inProgress': '진행 중',
      'card.closedNote': '이 심리는 종료되었습니다.', 'card.checkedIn': '체크인되었습니다.', 'card.wait': '예상 대기 ~{m}분',
      'card.limited': '귀하의 역할에서는 참여자 정보가 제한됩니다.',
      'officer.call': '심리 호출', 'officer.start': '시작 / 회의 열기', 'officer.close': '심리 종료',
      'officer.recall': '심리 재호출', 'officer.deny': '거부', 'officer.reassign': '재배정…',
      'officer.waiting': '한 명 이상의 참여자가 체크인하고 참여 가능해질 때까지 기다리는 중입니다.',
      'role.appellant': '항소인', 'role.appellant_rep': '항소인 대리인', 'role.appellant_witness': '항소인 증인',
      'role.agency_rep': '기관 대표', 'role.agency_witness': '기관 증인', 'role.interpreter': '통역사',
      'role.hearing_officer': '심리관 (ALJ)', 'role.admin_staff': '행정 직원', 'role.supervisor': '감독관 / 서기',
      'summary.title': 'AI 심리 요약', 'summary.generate': '생성', 'summary.regenerate': '다시 생성',
      'filter.all': '모든 상태', 'sort.time': '정렬: 예정 시간', 'sort.appellant': '정렬: 항소인 이름',
      'sort.status': '정렬: 상태', 'sort.agency': '정렬: 기관', 'lang.select': '언어 선택',
    },
    ar: {
      'app.title': 'غرفة الانتظار الافتراضية', 'common.language': 'اللغة', 'common.empty': 'لا توجد جلسات تطابق العرض الخاص بك.',
      'nav.live': 'مباشر', 'nav.offline': 'غير متصل', 'nav.reset': 'إعادة تعيين', 'nav.signout': 'تسجيل الخروج',
      'login.signinVia': 'تسجيل الدخول عبر ITS Identity (SSO)', 'login.signin': 'تسجيل الدخول عبر SSO',
      'view.my': 'جلساتي', 'view.assigned': 'الجلسات المسندة إليّ', 'view.oversight': 'جميع الجلسات — لوحة الإشراف', 'view.support': 'الجلسات التي أدعمها',
      'status.not_checked_in': 'لم يتم تسجيل الوصول', 'status.not_ready': 'غير جاهز', 'status.ready': 'جاهز للجلسة',
      'status.called': 'تم الاستدعاء', 'status.recalled': 'أُعيد الاستدعاء', 'status.closed': 'مغلق',
      'card.appellant': 'المستأنف', 'card.time': 'الوقت', 'card.aid': 'نوع المساعدة', 'card.disposition': 'القرار',
      'card.checkin': 'تسجيل الوصول', 'card.checkout': 'تسجيل الخروج', 'card.available': 'متاح', 'card.unavailable': 'غير متاح',
      'card.join': 'الانضمام إلى الجلسة الافتراضية (فيديو)', 'card.participants': 'المشاركون',
      'card.pNotChecked': 'لم يسجّل الوصول', 'card.removed': 'تمت الإزالة', 'card.inProgress': 'جارية',
      'card.closedNote': 'هذه الجلسة مغلقة.', 'card.checkedIn': 'لقد سجّلت وصولك.', 'card.wait': 'الانتظار المقدّر ~{m} دقيقة',
      'card.limited': 'تفاصيل المشاركين محدودة حسب دورك.',
      'officer.call': 'استدعاء الجلسة', 'officer.start': 'بدء / إطلاق المؤتمر', 'officer.close': 'إغلاق الجلسة',
      'officer.recall': 'إعادة استدعاء الجلسة', 'officer.deny': 'رفض', 'officer.reassign': 'إعادة التعيين إلى…',
      'officer.waiting': 'في انتظار تسجيل وصول مشارك واحد على الأقل وتوفره.',
      'role.appellant': 'المستأنف', 'role.appellant_rep': 'ممثل المستأنف', 'role.appellant_witness': 'شاهد المستأنف',
      'role.agency_rep': 'ممثل الوكالة', 'role.agency_witness': 'شاهد الوكالة', 'role.interpreter': 'مترجم فوري',
      'role.hearing_officer': 'قاضي الجلسة (ALJ)', 'role.admin_staff': 'الموظفون الإداريون', 'role.supervisor': 'مشرف / كاتب',
      'summary.title': 'ملخص الجلسة بالذكاء الاصطناعي', 'summary.generate': 'إنشاء', 'summary.regenerate': 'إعادة الإنشاء',
      'filter.all': 'جميع الحالات', 'sort.time': 'ترتيب: الوقت المحدد', 'sort.appellant': 'ترتيب: اسم المستأنف',
      'sort.status': 'ترتيب: الحالة', 'sort.agency': 'ترتيب: الوكالة', 'lang.select': 'اختر اللغة',
    },
    it: {
      'app.title': "Sala d'Attesa Virtuale", 'common.language': 'Lingua', 'common.empty': 'Nessuna udienza corrisponde alla tua vista.',
      'nav.live': 'In linea', 'nav.offline': 'Non in linea', 'nav.reset': 'Reimposta', 'nav.signout': 'Esci',
      'login.signinVia': 'Accedi con ITS Identity (SSO)', 'login.signin': 'Accedi con SSO',
      'view.my': 'Le Mie Udienze', 'view.assigned': 'Udienze Assegnate a Me',
      'view.oversight': 'Tutte le Udienze — Pannello di Supervisione', 'view.support': 'Udienze che Supporto',
      'status.not_checked_in': 'Non Registrato', 'status.not_ready': 'Non Pronto', 'status.ready': "Pronto per l'Udienza",
      'status.called': 'Chiamato', 'status.recalled': 'Richiamato', 'status.closed': 'Chiuso',
      'card.appellant': 'Ricorrente', 'card.time': 'Ora', 'card.aid': 'Tipo di Aiuto', 'card.disposition': 'Decisione',
      'card.checkin': 'Registrati', 'card.checkout': 'Esci', 'card.available': 'Disponibile', 'card.unavailable': 'Non Disponibile',
      'card.join': "Partecipa all'Udienza Virtuale (Video)", 'card.participants': 'Partecipanti',
      'card.pNotChecked': 'Non registrato', 'card.removed': 'Rimosso', 'card.inProgress': 'In corso',
      'card.closedNote': 'Questa udienza è chiusa.', 'card.checkedIn': 'Sei registrato.', 'card.wait': 'Attesa stimata ~{m} min',
      'card.limited': 'I dettagli dei partecipanti sono limitati per il tuo ruolo.',
      'officer.call': "Chiama l'Udienza", 'officer.start': 'Avvia / Apri Conferenza', 'officer.close': 'Chiudi Udienza',
      'officer.recall': 'Richiama Udienza', 'officer.deny': 'Rifiuta', 'officer.reassign': 'Riassegna a…',
      'officer.waiting': 'In attesa che almeno un partecipante si registri e sia disponibile.',
      'role.appellant': 'Ricorrente', 'role.appellant_rep': 'Rappresentante del Ricorrente', 'role.appellant_witness': 'Testimone del Ricorrente',
      'role.agency_rep': "Rappresentante dell'Agenzia", 'role.agency_witness': "Testimone dell'Agenzia", 'role.interpreter': 'Interprete',
      'role.hearing_officer': "Giudice dell'Udienza (ALJ)", 'role.admin_staff': 'Personale Amministrativo', 'role.supervisor': 'Supervisore / Cancelliere',
      'summary.title': 'Riepilogo Udienza IA', 'summary.generate': 'Genera', 'summary.regenerate': 'Rigenera',
      'filter.all': 'Tutti gli stati', 'sort.time': 'Ordina: Orario previsto', 'sort.appellant': 'Ordina: Nome ricorrente',
      'sort.status': 'Ordina: Stato', 'sort.agency': 'Ordina: Agenzia', 'lang.select': 'Seleziona lingua',
    },
    pl: {
      'app.title': 'Wirtualna Poczekalnia', 'common.language': 'Język', 'common.empty': 'Brak rozpraw pasujących do Twojego widoku.',
      'nav.live': 'Na żywo', 'nav.offline': 'Offline', 'nav.reset': 'Resetuj', 'nav.signout': 'Wyloguj',
      'login.signinVia': 'Zaloguj się przez ITS Identity (SSO)', 'login.signin': 'Zaloguj się przez SSO',
      'view.my': 'Moje Rozprawy', 'view.assigned': 'Przydzielone Mi Rozprawy',
      'view.oversight': 'Wszystkie Rozprawy — Panel Nadzoru', 'view.support': 'Rozprawy, które Wspieram',
      'status.not_checked_in': 'Niezameldowany', 'status.not_ready': 'Niegotowy', 'status.ready': 'Gotowy do Rozprawy',
      'status.called': 'Wezwany', 'status.recalled': 'Wezwany Ponownie', 'status.closed': 'Zamknięty',
      'card.appellant': 'Odwołujący', 'card.time': 'Godzina', 'card.aid': 'Rodzaj Pomocy', 'card.disposition': 'Rozstrzygnięcie',
      'card.checkin': 'Zamelduj się', 'card.checkout': 'Wymelduj się', 'card.available': 'Dostępny', 'card.unavailable': 'Niedostępny',
      'card.join': 'Dołącz do Rozprawy Wirtualnej (Wideo)', 'card.participants': 'Uczestnicy',
      'card.pNotChecked': 'Niezameldowany', 'card.removed': 'Usunięty', 'card.inProgress': 'W toku',
      'card.closedNote': 'Ta rozprawa jest zamknięta.', 'card.checkedIn': 'Jesteś zameldowany.', 'card.wait': 'Szac. czas oczekiwania ~{m} min',
      'card.limited': 'Szczegóły uczestników są ograniczone dla Twojej roli.',
      'officer.call': 'Wezwij na Rozprawę', 'officer.start': 'Rozpocznij / Uruchom Konferencję', 'officer.close': 'Zamknij Rozprawę',
      'officer.recall': 'Wezwij Ponownie', 'officer.deny': 'Odmów', 'officer.reassign': 'Przydziel ponownie do…',
      'officer.waiting': 'Oczekiwanie, aż co najmniej jeden uczestnik się zamelduje i będzie dostępny.',
      'role.appellant': 'Odwołujący', 'role.appellant_rep': 'Pełnomocnik Odwołującego', 'role.appellant_witness': 'Świadek Odwołującego',
      'role.agency_rep': 'Przedstawiciel Agencji', 'role.agency_witness': 'Świadek Agencji', 'role.interpreter': 'Tłumacz',
      'role.hearing_officer': 'Sędzia (ALJ)', 'role.admin_staff': 'Personel Administracyjny', 'role.supervisor': 'Kierownik / Sekretarz',
      'summary.title': 'Podsumowanie Rozprawy AI', 'summary.generate': 'Generuj', 'summary.regenerate': 'Generuj ponownie',
      'filter.all': 'Wszystkie statusy', 'sort.time': 'Sortuj: Zaplanowany czas', 'sort.appellant': 'Sortuj: Nazwisko odwołującego',
      'sort.status': 'Sortuj: Status', 'sort.agency': 'Sortuj: Agencja', 'lang.select': 'Wybierz język',
    },
    fr: {
      'app.title': "Salle d'Attente Virtuelle", 'common.language': 'Langue', 'common.empty': 'Aucune audience ne correspond à votre vue.',
      'nav.live': 'En ligne', 'nav.offline': 'Hors ligne', 'nav.reset': 'Réinitialiser', 'nav.signout': 'Se déconnecter',
      'login.signinVia': 'Se connecter via ITS Identity (SSO)', 'login.signin': 'Se connecter via SSO',
      'view.my': 'Mes Audiences', 'view.assigned': 'Audiences qui me sont Assignées',
      'view.oversight': 'Toutes les Audiences — Tableau de Supervision', 'view.support': 'Audiences que je Soutiens',
      'status.not_checked_in': 'Non Enregistré', 'status.not_ready': 'Pas Prêt', 'status.ready': "Prêt pour l'Audience",
      'status.called': 'Appelé', 'status.recalled': 'Rappelé', 'status.closed': 'Clôturé',
      'card.appellant': 'Appelant', 'card.time': 'Heure', 'card.aid': "Type d'Aide", 'card.disposition': 'Décision',
      'card.checkin': "S'enregistrer", 'card.checkout': 'Se retirer', 'card.available': 'Disponible', 'card.unavailable': 'Indisponible',
      'card.join': "Rejoindre l'Audience Virtuelle (Vidéo)", 'card.participants': 'Participants',
      'card.pNotChecked': 'Non enregistré', 'card.removed': 'Retiré', 'card.inProgress': 'En cours',
      'card.closedNote': 'Cette audience est clôturée.', 'card.checkedIn': 'Vous êtes enregistré.', 'card.wait': 'Attente estimée ~{m} min',
      'card.limited': 'Les détails des participants sont limités pour votre rôle.',
      'officer.call': "Appeler l'Audience", 'officer.start': 'Démarrer / Lancer la Conférence', 'officer.close': "Clôturer l'Audience",
      'officer.recall': "Rappeler l'Audience", 'officer.deny': 'Refuser', 'officer.reassign': 'Réassigner à…',
      'officer.waiting': "En attente qu'au moins un participant s'enregistre et soit disponible.",
      'role.appellant': 'Appelant', 'role.appellant_rep': "Représentant de l'Appelant", 'role.appellant_witness': "Témoin de l'Appelant",
      'role.agency_rep': "Représentant de l'Agence", 'role.agency_witness': "Témoin de l'Agence", 'role.interpreter': 'Interprète',
      'role.hearing_officer': 'Juge Administratif (ALJ)', 'role.admin_staff': 'Personnel Administratif', 'role.supervisor': 'Superviseur / Greffier',
      'summary.title': "Résumé d'Audience IA", 'summary.generate': 'Générer', 'summary.regenerate': 'Régénérer',
      'filter.all': 'Tous les statuts', 'sort.time': 'Trier : Heure prévue', 'sort.appellant': "Trier : Nom de l'appelant",
      'sort.status': 'Trier : Statut', 'sort.agency': 'Trier : Agence', 'lang.select': 'Choisir la langue',
    },
    ur: {
      'app.title': 'ورچوئل ویٹنگ روم', 'common.language': 'زبان', 'common.empty': 'آپ کے منظر سے مطابقت رکھنے والی کوئی سماعت نہیں۔',
      'nav.live': 'لائیو', 'nav.offline': 'آف لائن', 'nav.reset': 'ری سیٹ', 'nav.signout': 'سائن آؤٹ',
      'login.signinVia': 'ITS Identity (SSO) کے ذریعے سائن ان کریں', 'login.signin': 'SSO کے ذریعے سائن ان',
      'view.my': 'میری سماعتیں', 'view.assigned': 'مجھے تفویض کردہ سماعتیں',
      'view.oversight': 'تمام سماعتیں — نگرانی ڈیش بورڈ', 'view.support': 'وہ سماعتیں جن کی میں معاونت کرتا ہوں',
      'status.not_checked_in': 'چیک ان نہیں ہوا', 'status.not_ready': 'تیار نہیں', 'status.ready': 'سماعت کے لیے تیار',
      'status.called': 'بلایا گیا', 'status.recalled': 'دوبارہ بلایا گیا', 'status.closed': 'بند',
      'card.appellant': 'اپیل کنندہ', 'card.time': 'وقت', 'card.aid': 'امداد کی قسم', 'card.disposition': 'فیصلہ',
      'card.checkin': 'چیک ان', 'card.checkout': 'چیک آؤٹ', 'card.available': 'دستیاب', 'card.unavailable': 'غیر دستیاب',
      'card.join': 'ورچوئل سماعت میں شامل ہوں (ویڈیو)', 'card.participants': 'شرکاء',
      'card.pNotChecked': 'چیک ان نہیں ہوا', 'card.removed': 'ہٹا دیا گیا', 'card.inProgress': 'جاری ہے',
      'card.closedNote': 'یہ سماعت بند ہے۔', 'card.checkedIn': 'آپ چیک ان ہو چکے ہیں۔', 'card.wait': 'تخمینی انتظار ~{m} منٹ',
      'card.limited': 'آپ کے کردار کے لیے شرکاء کی تفصیلات محدود ہیں۔',
      'officer.call': 'سماعت کے لیے بلائیں', 'officer.start': 'شروع کریں / کانفرنس لانچ کریں', 'officer.close': 'سماعت بند کریں',
      'officer.recall': 'سماعت دوبارہ بلائیں', 'officer.deny': 'مسترد کریں', 'officer.reassign': 'دوبارہ تفویض کریں…',
      'officer.waiting': 'کم از کم ایک شریک کے چیک ان اور دستیاب ہونے کا انتظار ہے۔',
      'role.appellant': 'اپیل کنندہ', 'role.appellant_rep': 'اپیل کنندہ کا نمائندہ', 'role.appellant_witness': 'اپیل کنندہ کا گواہ',
      'role.agency_rep': 'ایجنسی کا نمائندہ', 'role.agency_witness': 'ایجنسی کا گواہ', 'role.interpreter': 'مترجم',
      'role.hearing_officer': 'سماعت افسر (ALJ)', 'role.admin_staff': 'انتظامی عملہ', 'role.supervisor': 'سپروائزر / کلرک',
      'summary.title': 'AI سماعت کا خلاصہ', 'summary.generate': 'تیار کریں', 'summary.regenerate': 'دوبارہ تیار کریں',
      'filter.all': 'تمام حالتیں', 'sort.time': 'ترتیب: مقررہ وقت', 'sort.appellant': 'ترتیب: اپیل کنندہ کا نام',
      'sort.status': 'ترتیب: حالت', 'sort.agency': 'ترتیب: ایجنسی', 'lang.select': 'زبان منتخب کریں',
    },
    yi: {
      'app.title': 'ווירטועלער ווארטצימער', 'common.language': 'שפּראַך', 'common.empty': 'קיין הירונגען וואָס פּאַסן צו אײַער מבט.',
      'nav.live': 'לײַוו', 'nav.offline': 'אָפֿלײַן', 'nav.reset': 'רעסעט', 'nav.signout': 'אַרויסלאָגירן',
      'login.signinVia': 'אַרײַנלאָגירן דורך ITS Identity (SSO)', 'login.signin': 'אַרײַנלאָגירן דורך SSO',
      'view.my': 'מײַנע הירונגען', 'view.assigned': 'הירונגען צוגעטיילט צו מיר',
      'view.oversight': 'אַלע הירונגען — אויפזיכט טאַוול', 'view.support': 'הירונגען וואָס איך שטיצן',
      'status.not_checked_in': 'נישט אײַנגעטשעקט', 'status.not_ready': 'נישט גרייט', 'status.ready': 'גרייט פֿאַר הירונג',
      'status.called': 'גערופֿן', 'status.recalled': 'ווידער גערופֿן', 'status.closed': 'פֿאַרמאַכט',
      'card.appellant': 'אַפּעלאַנט', 'card.time': 'צײַט', 'card.aid': 'טיפּ הילף', 'card.disposition': 'באַשלוס',
      'card.checkin': 'אײַנטשעקן', 'card.checkout': 'אַרויסטשעקן', 'card.available': 'פֿאַראַן', 'card.unavailable': 'נישט פֿאַראַן',
      'card.join': 'אַרײַנגיין אין דער ווירטועלער הירונג (ווידעאָ)', 'card.participants': 'טיילנעמער',
      'card.pNotChecked': 'נישט אײַנגעטשעקט', 'card.removed': 'אַראָפּגענומען', 'card.inProgress': 'אין גאַנג',
      'card.closedNote': 'די הירונג איז פֿאַרמאַכט.', 'card.checkedIn': 'איר זענט אײַנגעטשעקט.', 'card.wait': 'געשאַצטע וואַרטן ~{m} מינ',
      'card.limited': 'טיילנעמער פּרטים זענען באַגרענעצט פֿאַר אײַער ראָלע.',
      'officer.call': 'רופֿן די הירונג', 'officer.start': 'אָנהייבן / עפֿענען קאָנפֿערענץ', 'officer.close': 'פֿאַרמאַכן הירונג',
      'officer.recall': 'ווידער רופֿן הירונג', 'officer.deny': 'אָפּזאָגן', 'officer.reassign': 'איבערטיילן צו…',
      'officer.waiting': 'וואַרטן אַז כאָטש איין טיילנעמער זאָל זיך אײַנטשעקן און זײַן פֿאַראַן.',
      'role.appellant': 'אַפּעלאַנט', 'role.appellant_rep': 'פֿאָרשטייער פֿונעם אַפּעלאַנט', 'role.appellant_witness': 'עדות פֿונעם אַפּעלאַנט',
      'role.agency_rep': 'פֿאָרשטייער פֿון דער אַגענטור', 'role.agency_witness': 'עדות פֿון דער אַגענטור', 'role.interpreter': 'דאָלמעטשער',
      'role.hearing_officer': 'הירונג אָפֿיציר (ALJ)', 'role.admin_staff': 'אַדמיניסטראַטיווע פּערסאָנאַל', 'role.supervisor': 'סופּערווייזער / קלערק',
      'summary.title': 'AI הירונג רעזיומע', 'summary.generate': 'שאַפֿן', 'summary.regenerate': 'ווידער שאַפֿן',
      'filter.all': 'אַלע סטאַטוסן', 'sort.time': 'סאָרטירן: באַשטימטע צײַט', 'sort.appellant': 'סאָרטירן: אַפּעלאַנט נאָמען',
      'sort.status': 'סאָרטירן: סטאַטוס', 'sort.agency': 'סאָרטירן: אַגענטור', 'lang.select': 'אויסקלײַבן שפּראַך',
    },
  };

  let lang = localStorage.getItem('vwrLang') || 'en';
  if (!STRINGS[lang]) lang = 'en';

  function t(key, vars) {
    const d = STRINGS[lang] || STRINGS.en;
    let s = d[key] != null ? d[key] : (STRINGS.en[key] != null ? STRINGS.en[key] : key);
    if (vars) for (const k in vars) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    return s;
  }

  function applyStatic(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    r.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    r.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    r.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('label', t(el.getAttribute('data-i18n-label'))); });
  }

  function setDir() {
    document.documentElement.dir = DIR[lang] || 'ltr';
    document.documentElement.lang = lang;
  }

  function setLang(l) {
    if (!STRINGS[l]) l = 'en';
    lang = l;
    localStorage.setItem('vwrLang', l);
    setDir();
    applyStatic();
    if (typeof window.VWRonLangChange === 'function') window.VWRonLangChange();
  }

  window.VWRi18n = {
    t, setLang, getLang: () => lang, LANGS, applyStatic,
    init: () => {},                 // all languages baked; no async setup needed
  };

  setDir();
  document.addEventListener('DOMContentLoaded', () => applyStatic());
})();
```

## `public/app.js`

```js
/* NYS Virtual Waiting Room — client */
(() => {
  'use strict';

  const socket = io();
  window.VWRSocket = socket;   // shared with conference.js
  let session = null;       // current logged-in user (SSO assertion)
  let state = { hearings: [], auditLog: [] };
  let ROLES = {};

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // i18n shorthand
  const t = (k, v) => (window.VWRi18n ? window.VWRi18n.t(k, v) : k);
  const roleLabel = (code) => t('role.' + code);

  const STATUS_META = {
    not_checked_in: { cls: 'st-none',     icon: 'remove' },
    not_ready:      { cls: 'st-notready', icon: 'progress_activity' },
    ready:          { cls: 'st-ready',    icon: 'check_circle' },
    called:         { cls: 'st-called',   icon: 'phone_in_talk' },
    recalled:       { cls: 'st-recalled', icon: 'refresh' },
    closed:         { cls: 'st-closed',   icon: 'check' },
  };

  /* -------------------- Login -------------------- */

  let directoryUsers = [];

  async function initLogin() {
    const res = await fetch('/api/directory');
    const data = await res.json();
    ROLES = data.roles;
    directoryUsers = data.directory;

    if (window.VWRi18n) window.VWRi18n.init();
    setupLanguageMenu();

    refreshDirectoryOptions();
    refreshStatusFilter();
  }

  function refreshDirectoryOptions() {
    $('#user-select').innerHTML = directoryUsers
      .map((u) => `<option value="${u.userId}">${u.name} — ${roleLabel(u.role)}</option>`)
      .join('');
  }

  function refreshStatusFilter() {
    const fs = $('#filter-status');
    const cur = fs.value;
    fs.innerHTML = `<option value="">${t('filter.all')}</option>` +
      Object.keys(STATUS_META).map((k) => `<option value="${k}">${t('status.' + k)}</option>`).join('');
    fs.value = cur;
  }

  function updateLangCurrent() {
    const l = window.VWRi18n.LANGS.find((x) => x.code === window.VWRi18n.getLang());
    const cur = $('#lang-current');
    if (cur) cur.textContent = l ? l.name : 'English';
  }

  // Globe language menu (top-left), styled like the NYS Child Support selector.
  function setupLanguageMenu() {
    const btn = $('#lang-btn'), menu = $('#lang-menu');
    if (!btn || !menu) return;
    const cur = () => window.VWRi18n.getLang();
    menu.innerHTML = window.VWRi18n.LANGS.map((l) =>
      `<li role="menuitemradio" data-lang="${l.code}" lang="${l.code}" aria-checked="${l.code === cur()}" tabindex="0">${l.name}</li>`
    ).join('');
    updateLangCurrent();

    const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
    const pick = (code) => {
      window.VWRi18n.setLang(code);                 // synchronous — applies instantly
      menu.querySelectorAll('li').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.lang === code)));
      updateLangCurrent();
      close();
    };

    btn.onclick = (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
    };
    menu.onclick = (e) => { const li = e.target.closest('[data-lang]'); if (li) pick(li.dataset.lang); };
    menu.onkeydown = (e) => {
      const li = e.target.closest('[data-lang]');
      if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(li.dataset.lang); }
    };
    document.addEventListener('click', () => { if (!menu.classList.contains('hidden')) close(); });
  }

  // Re-localize everything when the language changes.
  window.VWRonLangChange = () => {
    updateLangCurrent();
    refreshDirectoryOptions();
    refreshStatusFilter();
    if (session) { $('#who-role').textContent = roleLabel(session.role); render(); }
  };

  $('#login-btn').addEventListener('click', async () => {
    const userId = $('#user-select').value;
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return toast('Login failed', 'error');
    session = await res.json();
    window.VWRSession = session;   // shared with conference.js
    socket.emit('identify', session);
    enterApp();
  });

  function enterApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#who-name').textContent = session.name;
    $('#who-role').textContent = roleLabel(session.role);
    render();
  }

  $('#logout-btn').addEventListener('click', () => location.reload());
  $('#reset-btn').addEventListener('click', () => socket.emit('resetDemo'));

  /* -------------------- Socket -------------------- */

  socket.on('connect', () => setConn(true));
  socket.on('disconnect', () => setConn(false));
  socket.on('state', (s) => { state = s; if (session) render(); });
  socket.on('toast', ({ type, msg }) => toast(msg, type));

  function setConn(ok) {
    const el = $('#conn-status');
    el.textContent = ok ? `● ${t('nav.live')}` : `● ${t('nav.offline')}`;
    el.classList.toggle('off', !ok);
  }

  /* -------------------- Action emitters -------------------- */
  const act = {
    checkin: (hearingId, userId) => socket.emit('checkin', { hearingId, userId }),
    checkout: (hearingId, userId) => socket.emit('checkout', { hearingId, userId }),
    avail: (hearingId, userId, status) => socket.emit('setAvailability', { hearingId, userId, status }),
    call: (hearingId, recall = false) => socket.emit('call', { hearingId, officerId: session.sub, recall }),
    deny: (hearingId, userId) => socket.emit('deny', { hearingId, userId }),
    start: (hearingId) => socket.emit('startHearing', { hearingId }),
    close: (hearingId) => {
      const d = prompt('Disposition for this hearing:', 'Decision Reserved');
      if (d !== null) socket.emit('closeHearing', { hearingId, disposition: d });
    },
    reopen: (hearingId) => socket.emit('reopen', { hearingId }),
    reassign: (hearingId, newOfficerId) => socket.emit('reassign', { hearingId, newOfficerId }),
  };

  /* -------------------- Filtering / sorting -------------------- */

  function visibleHearings() {
    let list = state.hearings.slice();
    const role = session.role;

    // Role scoping (spec §6)
    if (role === 'hearing_officer') {
      list = list.filter((h) => h.assignedOfficerId === session.sub);
    } else if (['appellant','appellant_rep','appellant_witness','agency_rep','agency_witness','interpreter'].includes(role)) {
      list = list.filter((h) => h.participants.some((p) => p.userId === session.sub));
    }
    // supervisor / admin_staff: see all

    // Search
    const q = $('#search').value.trim().toLowerCase();
    if (q) {
      list = list.filter((h) =>
        [h.hearingNumber, h.appellantName, h.hearingType, h.agency, h.categoryOfAid]
          .join(' ').toLowerCase().includes(q)
      );
    }
    // Status filter
    const sf = $('#filter-status').value;
    if (sf) list = list.filter((h) => h.status === sf);

    // Sort
    const sort = $('#sort').value;
    list.sort((a, b) => {
      if (sort === 'appellant') return a.appellantName.localeCompare(b.appellantName);
      if (sort === 'agency') return a.agency.localeCompare(b.agency);
      if (sort === 'status') return a.status.localeCompare(b.status);
      return a.scheduledTime.localeCompare(b.scheduledTime);
    });
    return list;
  }

  /* -------------------- Render -------------------- */

  function render() {
    const role = session.role;
    $('#view-title').textContent = viewTitle(role);

    const list = visibleHearings();
    const board = $('#board');

    if (!list.length) {
      board.innerHTML = `<div class="empty">${t('common.empty')}</div>`;
    } else if (role === 'supervisor' || role === 'admin_staff') {
      board.className = 'board board-table';
      board.innerHTML = renderSupervisor(list);
      loadRecordings();
    } else {
      board.className = 'board board-cards';
      board.innerHTML = list.map((h) => renderCard(h, role)).join('');
    }
    wireActions();
    renderAudit();
  }

  function viewTitle(role) {
    switch (role) {
      case 'hearing_officer': return t('view.assigned');
      case 'supervisor':
      case 'admin_staff': return t('view.oversight');
      case 'interpreter': return t('view.support');
      default: return t('view.my');
    }
  }

  function statusBadge(status) {
    const m = STATUS_META[status] || { cls: '', icon: 'info' };
    return `<span class="badge status ${m.cls}"><nys-icon name="${m.icon}" size="sm" aria-hidden="true"></nys-icon>${t('status.' + status)}</span>`;
  }

  function me(h) {
    return h.participants.find((p) => p.userId === session.sub);
  }

  function predFor(h) {
    return (state.predictions && state.predictions.perHearing && state.predictions.perHearing[h.id]) || null;
  }
  function waitChip(h) {
    const p = predFor(h);
    if (!p || h.status === 'closed') return '';
    if (p.inProgress) return `<span class="wait-chip in-progress"><nys-icon name="phone_in_talk" size="xs"></nys-icon> ${t('card.inProgress')}</span>`;
    return `<span class="wait-chip"><nys-icon name="progress_activity" size="xs"></nys-icon> ${t('card.wait', { m: p.estimatedWaitMin })}</span>`;
  }

  /* ---- Participant-style card (appellant, rep, agency, witness, interpreter) ---- */

  function renderCard(h, role) {
    const mine = me(h);
    const limited = role === 'interpreter' || role.endsWith('_witness'); // limited view (spec §6d.v, §6 witness)
    const isOfficer = role === 'hearing_officer';

    const participantsHtml = limited
      ? `<p class="limited-note">${t('card.limited')}</p>`
      : renderParticipantList(h, isOfficer);

    // Every participant — including the Hearing Officer (spec §6b.iii) — can
    // check in and confirm availability. The officer just gets call/close
    // controls in addition.
    let myControls = '';
    if (mine) {
      myControls = renderMyControls(h, mine);
    }
    const officerControls = isOfficer ? renderOfficerControls(h) : '';

    return `
      <article class="card ${h.status}" data-h="${h.id}">
        <div class="card-head">
          <div>
            <div class="card-title">${h.hearingNumber}</div>
            <div class="card-sub">${h.hearingType} · ${h.agency}</div>
          </div>
          ${statusBadge(h.status)}
        </div>
        <div class="card-meta">
          <span><b>${t('card.appellant')}:</b> ${h.appellantName}</span>
          <span><b>${t('card.time')}:</b> ${h.scheduledTime}</span>
          <span><b>${t('card.aid')}:</b> ${h.categoryOfAid}</span>
          ${h.disposition ? `<span><b>${t('card.disposition')}:</b> ${h.disposition}</span>` : ''}
          ${waitChip(h)}
        </div>
        ${myControls}
        ${officerControls}
        ${isOfficer ? renderSummary(h) : ''}
        <div class="card-participants">${participantsHtml}</div>
        ${h.conferenceUrl ? `<button class="conf-link" data-act="joinconf" data-h="${h.id}" data-hn="${h.hearingNumber}" data-host="${isOfficer && h.assignedOfficerId === session.sub ? '1' : '0'}"><nys-icon name="phone_in_talk" size="sm"></nys-icon> ${t('card.join')}</button>` : ''}
      </article>`;
  }

  function availBadge(p) {
    if (p.denied) return `<nys-badge intent="error" size="sm" label="${t('card.removed')}" prefixIcon="cancel"></nys-badge>`;
    if (!p.checkedIn) return `<nys-badge intent="neutral" size="sm" label="${t('card.pNotChecked')}"></nys-badge>`;
    return p.status === 'available'
      ? `<nys-badge intent="success" size="sm" label="${t('card.available')}" prefixIcon="check_circle"></nys-badge>`
      : `<nys-badge intent="warning" size="sm" label="${t('card.unavailable')}"></nys-badge>`;
  }

  function renderParticipantList(h, showDeny) {
    return `
      <div class="plist-title">${t('card.participants')}</div>
      <ul class="plist">
        ${h.participants.map((p) => `
          <li class="${p.denied ? 'denied' : ''}">
            <nys-icon name="account_circle" size="md" class="picon" aria-hidden="true"></nys-icon>
            <span class="pname">${p.name}</span>
            <span class="prole">${roleLabel(p.role)}</span>
            <span class="pstat">${availBadge(p)}</span>
            ${p.checkInTime ? `<span class="ptime">${fmtTime(p.checkInTime)}</span>` : ''}
            ${showDeny && p.checkedIn && p.role !== 'hearing_officer'
              ? `<button class="btn btn-danger btn-xs" data-act="deny" data-h="${h.id}" data-u="${p.userId}"><nys-icon name="cancel" size="xs"></nys-icon>${t('officer.deny')}</button>` : ''}
          </li>`).join('')}
      </ul>`;
  }

  function renderMyControls(h, mine) {
    const closed = h.status === 'closed';
    if (closed) return `<div class="my-controls"><span class="muted">${t('card.closedNote')}</span></div>`;
    if (!mine.checkedIn) {
      return `<div class="my-controls">
        <nys-button data-act="checkin" data-h="${h.id}" data-u="${mine.userId}" label="${t('card.checkin')}" prefixIcon="check_circle"></nys-button>
      </div>`;
    }
    const checkedMsg = mine.checkInTime ? t('card.checkedInAt', { time: fmtTime(mine.checkInTime) }) : t('card.checkedIn');
    return `
      <div class="my-controls">
        <span class="muted">${checkedMsg}</span>
        <div class="seg">
          <button class="btn btn-toggle ${mine.status === 'available' ? 'on' : ''}" data-act="avail" data-h="${h.id}" data-u="${mine.userId}" data-s="available">${t('card.available')}</button>
          <button class="btn btn-toggle ${mine.status === 'unavailable' ? 'on' : ''}" data-act="avail" data-h="${h.id}" data-u="${mine.userId}" data-s="unavailable">${t('card.unavailable')}</button>
        </div>
        <nys-button data-act="checkout" data-h="${h.id}" data-u="${mine.userId}" variant="outline" size="sm" label="${t('card.checkout')}" prefixIcon="close"></nys-button>
      </div>`;
  }

  function renderOfficerControls(h) {
    const ready = h.status === 'ready';
    const inHearing = h.status === 'called' || h.status === 'recalled';
    const closed = h.status === 'closed';

    const officers = (window.__officers || []);
    const reassign = `
      <select class="select select-sm" data-act="reassign" data-h="${h.id}" aria-label="Reassign hearing officer">
        <option value="">${t('officer.reassign')}</option>
        ${officers.filter(o => o.userId !== h.assignedOfficerId).map(o => `<option value="${o.userId}">${o.name}</option>`).join('')}
      </select>`;

    let primary = '';
    let hint = '';
    if (closed) {
      primary = `<nys-button data-act="reopen" data-h="${h.id}" variant="outline" label="${t('officer.recall')}" prefixIcon="refresh"></nys-button>`;
    } else if (inHearing) {
      primary = `
        <nys-button data-act="start" data-h="${h.id}" label="${t('officer.start')}" prefixIcon="phone_in_talk"></nys-button>
        <button class="btn btn-danger" data-act="close" data-h="${h.id}"><nys-icon name="cancel" size="sm"></nys-icon>${t('officer.close')}</button>`;
    } else {
      primary = `<nys-button data-act="call" data-h="${h.id}" label="${t('officer.call')}" prefixIcon="phone_in_talk" ${ready ? '' : 'disabled'}></nys-button>`;
      if (!ready) {
        hint = `<div class="muted blockers"><nys-icon name="progress_activity" size="xs"></nys-icon> ${t('officer.waiting')}</div>`;
      }
    }

    return `<div class="officer-controls">
      ${primary}
      ${!closed ? reassign : ''}
      ${hint}
    </div>`;
  }

  function renderSummary(h) {
    const has = !!h.summary;
    const info = (h.transcript && h.transcript.length) ? `${h.transcript.length} caption lines` : 'no captions yet';
    return `
      <div class="summary-box">
        <div class="summary-head">
          <span><nys-icon name="edit_square" size="sm"></nys-icon> ${t('summary.title')}</span>
          <button class="btn btn-ghost btn-xs" data-act="gensummary" data-h="${h.id}">${has ? t('summary.regenerate') : t('summary.generate')}</button>
        </div>
        ${has
          ? `<div class="summary-body">${mdLite(h.summary)}</div>`
          : `<div class="muted summary-empty">${t('summary.empty', { info })}</div>`}
      </div>`;
  }

  // Minimal, safe Markdown-ish rendering (escape, then bold + headings + line breaks).
  function mdLite(s) {
    const esc = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/^### (.*)$/gm, '<strong>$1</strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  /* ---- Supervisor / admin table (spec §6c) ---- */

  function renderSupervisor(list) {
    const officersAttending = list
      .filter((h) => h.status === 'called' || h.status === 'recalled')
      .map((h) => `${officerName(h.assignedOfficerId)} → ${h.hearingNumber}`);

    const banner = officersAttending.length
      ? `<div class="sup-banner"><b>Officers currently in hearing:</b> ${officersAttending.join(' · ')}</div>`
      : `<div class="sup-banner muted">No officers currently in an active hearing.</div>`;

    const rows = list.map((h) => {
      const checkedIn = h.participants.filter((p) => p.checkedIn).length;
      const pr = predFor(h);
      const wait = h.status === 'closed' ? '—' : pr ? (pr.inProgress ? 'in progress' : `~${pr.estimatedWaitMin} min`) : '—';
      return `
        <tr class="row-${h.status}">
          <td>${h.scheduledTime}</td>
          <td><b>${h.hearingNumber}</b><br><span class="muted">${h.hearingType}</span></td>
          <td>${h.appellantName}</td>
          <td>${h.agency}<br><span class="muted">${h.categoryOfAid}</span></td>
          <td>${officerName(h.assignedOfficerId)}</td>
          <td>${statusBadge(h.status)}</td>
          <td>${checkedIn}/${h.participants.length}</td>
          <td>${wait}</td>
          <td>${h.summary ? '<nys-icon name="edit_square" size="sm" title="Summary available"></nys-icon> ' : ''}${h.disposition || '—'}</td>
        </tr>`;
    }).join('');

    return `
      <div class="rec-panel">
        <div class="rec-panel-head">
          <nys-icon name="phone_in_talk" size="sm" aria-hidden="true"></nys-icon>
          Hearing Recordings
          <button class="btn btn-ghost btn-xs" data-act="refreshrec" title="Refresh"><nys-icon name="refresh" size="xs"></nys-icon></button>
        </div>
        <div id="rec-list" class="rec-list">Loading recordings…</div>
      </div>
      ${banner}
      <div class="pred-banner">
        <span><nys-icon name="progress_activity" size="sm"></nys-icon> <b>Docket prediction:</b> avg hearing ≈ ${(state.predictions || {}).avgDurationMin || '—'} min.</span>
        ${((state.predictions || {}).suggestions || []).map((s) => `<span class="pred-suggest">⚖ ${s}</span>`).join('')}
      </div>
      <table class="sup-table">
        <thead>
          <tr><th>Time</th><th>Hearing</th><th>Appellant</th><th>Agency / Aid</th><th>Officer</th><th>Status</th><th>Checked In</th><th>Est. wait</th><th>Disposition</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function officerName(id) {
    if (!id) return '<span class="muted">Unassigned</span>';
    const o = (window.__officers || []).find((x) => x.userId === id);
    if (o) return o.name;
    // fallback to participant lookup
    for (const h of state.hearings) {
      const p = h.participants.find((pp) => pp.userId === id);
      if (p) return p.name;
    }
    return id;
  }

  /* -------------------- Action wiring -------------------- */

  function wireActions() {
    $$('[data-act]').forEach((el) => {
      const a = el.dataset.act;
      if (a === 'avail') {
        el.onclick = () => act.avail(el.dataset.h, el.dataset.u, el.dataset.s);
      } else if (a === 'reassign') {
        el.onchange = () => { if (el.value) act.reassign(el.dataset.h, el.value); };
      } else if (a === 'checkin') {
        el.onclick = () => act.checkin(el.dataset.h, el.dataset.u);
      } else if (a === 'checkout') {
        el.onclick = () => act.checkout(el.dataset.h, el.dataset.u);
      } else if (a === 'deny') {
        el.onclick = () => act.deny(el.dataset.h, el.dataset.u);
      } else if (a === 'call') {
        el.onclick = () => act.call(el.dataset.h, false);
      } else if (a === 'start') {
        el.onclick = () => act.start(el.dataset.h);
      } else if (a === 'close') {
        el.onclick = () => act.close(el.dataset.h);
      } else if (a === 'reopen') {
        el.onclick = () => act.reopen(el.dataset.h);
      } else if (a === 'joinconf') {
        el.onclick = () => window.VWRConf.join(el.dataset.h, el.dataset.hn, el.dataset.host === '1');
      } else if (a === 'refreshrec') {
        el.onclick = () => loadRecordings();
      } else if (a === 'gensummary') {
        el.onclick = () => {
          el.textContent = t('summary.generating');
          fetch('/api/ai/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hearingId: el.dataset.h, actor: session.name }) })
            .then((r) => r.json())
            .then((d) => toast(`Summary ready (${d.provider === 'anthropic' ? 'AI' : 'demo'}).`, 'info'))
            .catch(() => toast('Summary failed.', 'error'));
        };
      }
    });
  }

  $('#search').addEventListener('input', () => session && render());
  $('#sort').addEventListener('change', () => session && render());
  $('#filter-status').addEventListener('change', () => session && render());

  /* -------------------- Audit + reporting -------------------- */

  $('#audit-toggle').addEventListener('click', () => {
    const d = $('#audit-drawer');
    d.classList.toggle('collapsed');
    const open = !d.classList.contains('collapsed');
    $('#audit-toggle').setAttribute('aria-expanded', String(open));
    if (open) refreshReport();
  });

  async function refreshReport() {
    try {
      const r = await fetch('/api/report');
      const rep = await r.json();
      const sc = rep.statusCounts;
      $('#report-strip').innerHTML = `
        <div class="stat"><span class="stat-n">${rep.totalHearings}</span><span class="stat-l">Hearings</span></div>
        <div class="stat"><span class="stat-n">${sc.ready}</span><span class="stat-l">Ready</span></div>
        <div class="stat"><span class="stat-n">${sc.called + sc.recalled}</span><span class="stat-l">In Hearing</span></div>
        <div class="stat"><span class="stat-n">${sc.closed}</span><span class="stat-l">Closed</span></div>
        <div class="stat"><span class="stat-n">${rep.totalCheckIns}</span><span class="stat-l">Check-ins</span></div>`;
    } catch (_) {}
  }

  function renderAudit() {
    const ul = $('#audit-list');
    if (!ul) return;
    ul.innerHTML = (state.auditLog || []).slice(0, 30).map((e) => `
      <li>
        <span class="audit-time">${fmtTime(e.ts)}</span>
        <span class="audit-action">${e.action}</span>
        <span class="audit-detail">${e.detail}</span>
      </li>`).join('');
    if (!$('#audit-drawer').classList.contains('collapsed')) refreshReport();
  }

  /* -------------------- Recordings panel -------------------- */

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function loadRecordings() {
    const el = $('#rec-list');
    if (!el) return;
    fetch('/api/recordings').then((r) => r.json()).then(({ recordings }) => {
      const target = $('#rec-list');
      if (!target) return;
      if (!recordings || !recordings.length) {
        target.innerHTML = `<div class="rec-empty">No recordings yet. A Hearing Officer can record from within a hearing.</div>`;
        return;
      }
      target.innerHTML = recordings.map((rec) => `
        <div class="rec-item">
          <video class="rec-video" src="${rec.url}" controls preload="none"></video>
          <div class="rec-meta">
            <div class="rec-name">${rec.file}</div>
            <div class="rec-sub">${fmtBytes(rec.bytes)} · ${fmtTime(rec.savedAt)}</div>
            <a class="btn btn-ghost btn-xs" href="${rec.url}" download><nys-icon name="download" size="xs"></nys-icon> Download</a>
          </div>
        </div>`).join('');
    }).catch(() => {
      const target = $('#rec-list');
      if (target) target.innerHTML = `<div class="rec-empty">Could not load recordings.</div>`;
    });
  }

  /* -------------------- Utilities -------------------- */

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
  }
  window.VWRToast = toast;   // shared with conference.js

  function tickClock() {
    $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  setInterval(tickClock, 1000); tickClock();

  // cache officer directory for reassign + name lookup
  fetch('/api/directory').then(r => r.json()).then(d => {
    window.__officers = d.directory.filter(u => u.role === 'hearing_officer');
  });

  /* -------------------- Boot -------------------- */
  initLogin();
})();
```

## `public/conference.js`

```js
/* NYS Virtual Waiting Room — In-house conferencing (WebRTC mesh)
 *
 * Replaces the external Cisco WebEx/CMR launch with a NYS-hosted peer-to-peer
 * conference. Signaling rides the existing Socket.io connection (window.VWRSocket).
 *
 * Topology: full mesh. Each participant holds one RTCPeerConnection per peer.
 * Fine for hearing-sized rooms (≤ ~8 parties). For larger rooms you'd add an SFU.
 */
(() => {
  'use strict';

  const ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  let socket = null;
  let session = null;
  let current = null;                 // { hearingId, hearingNumber, isHost }
  let localStream = null;
  let screenStream = null;
  const peers = {};                   // socketId -> { pc, info, stream }
  let micOn = true, camOn = true, sharing = false, recording = false;
  let bound = false;

  // Recording state (host records a composite of all tiles + mixed audio)
  let mediaRecorder = null, recChunks = [], recCanvas = null, recCtx = null,
      recRAF = 0, recAudioCtx = null, recDest = null, recConnected = null,
      recMime = '', recStart = null;

  // Captions / translation state
  let recognition = null, captionsOn = false, capLang = '', capHideTimer = 0;

  const $ = (id) => document.getElementById(id);

  /* Audio/video control icons. NYSDS ships 80 icons but none of the
   * conferencing glyphs (mic, videocam, screen_share, call_end, record),
   * so we inline the matching Google Material icons — the same family NYSDS
   * draws from — to stay visually consistent with <nys-icon>. */
  const ICONS = {
    mic: '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>',
    mic_off: '<path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>',
    videocam: '<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>',
    videocam_off: '<path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18zM3.27 2 2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73z"/>',
    screen_share: '<path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74z"/>',
    chat: '<path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12zm0-3H6V9h12zm0-3H6V6h12z"/>',
    call_end: '<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>',
    record: '<circle cx="12" cy="12" r="7"/>',
    remove: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  };
  const svg = (name) => `<svg class="cic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  /* ----------------------------- Join / leave ----------------------------- */

  async function join(hearingId, hearingNumber, isHost) {
    socket = window.VWRSocket;
    session = window.VWRSession;
    if (!socket || !session) return alert('Not connected.');

    current = { hearingId, hearingNumber, isHost };
    $('conf').classList.remove('hidden');
    $('conf-title').textContent = `${hearingNumber} — Virtual Hearing`;
    document.body.classList.add('conf-open');

    // Acquire media with graceful fallback (camera may be busy on a shared demo machine).
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        camOn = false;
        toast('Camera unavailable — joined audio-only.');
      } catch (e2) {
        localStream = new MediaStream();
        micOn = false; camOn = false;
        toast('No camera/mic — joined as viewer.');
      }
    }

    addSelfTile();
    updateButtons();
    bindSocket();
    socket.emit('conf:join', {
      hearingId,
      user: { name: session.name, role: session.role, sub: session.sub },
    });
  }

  function leave() {
    if (!current) return;
    if (recording) { recording = false; socket.emit('conf:rec', { hearingId: current.hearingId, on: false }); stopRecording(); }
    if (captionsOn) { captionsOn = false; stopRecognition(); }
    socket.emit('conf:leave');
    Object.keys(peers).forEach(removePeer);
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    localStream = screenStream = null;
    sharing = recording = false;
    $('conf-stage').innerHTML = '';
    $('conf-chat-msgs').innerHTML = '';
    $('conf').classList.add('hidden');
    $('conf-chat').classList.add('hidden');
    document.body.classList.remove('conf-open');
    current = null;
  }

  /* ----------------------------- Signaling ----------------------------- */

  function bindSocket() {
    if (bound) return;
    bound = true;

    socket.on('conf:peers', ({ peers: existing }) => {
      // We're the newcomer: initiate an offer to every existing peer.
      existing.forEach((info) => createPeer(info.id, info, true));
    });

    socket.on('conf:peer-joined', (info) => {
      toast(`${info.name} joined the hearing`);
    });

    socket.on('conf:signal', async ({ from, data, user }) => {
      let entry = peers[from] || createPeer(from, user, false);
      const pc = entry.pc;
      try {
        if (data.sdp) {
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('conf:signal', { to: from, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
      } catch (err) { /* ignore transient negotiation errors */ }
    });

    socket.on('conf:peer-left', ({ id }) => removePeer(id));
    socket.on('conf:roster', ({ peers: list }) => updateCount(list.length));
    socket.on('conf:chat', addChat);
    socket.on('conf:force-mute', () => { if (micOn) toggleMic(); toast('You were muted by the Hearing Officer.'); });
    socket.on('conf:force-remove', () => { toast('You were removed from the hearing.'); leave(); });
    socket.on('conf:rec', ({ on }) => setRecIndicator(on));
    socket.on('conf:caption', showCaption);
  }

  function createPeer(peerId, info, initiator) {
    if (peers[peerId]) return peers[peerId];
    const pc = new RTCPeerConnection(ICE);
    const entry = { pc, info: info || {}, stream: new MediaStream() };
    peers[peerId] = entry;

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('conf:signal', { to: peerId, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      e.streams[0].getTracks().forEach((t) => entry.stream.addTrack(t));
      const v = $(`vid-${peerId}`);
      if (v) v.srcObject = entry.stream;
      if (recAudioCtx) recConnect(entry.stream);   // include late joiner in an active recording
    };
    pc.onconnectionstatechange = () => {
      const tile = $(`tile-${peerId}`);
      if (tile) tile.dataset.state = pc.connectionState;
    };
    // Only the initiator drives negotiation, to avoid offer/answer glare.
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('conf:signal', { to: peerId, data: { sdp: pc.localDescription } });
        } catch (_) {}
      };
    }

    addRemoteTile(peerId, entry.info);
    return entry;
  }

  function removePeer(peerId) {
    const entry = peers[peerId];
    if (!entry) return;
    try { entry.pc.close(); } catch (_) {}
    const tile = $(`tile-${peerId}`);
    if (tile) tile.remove();
    delete peers[peerId];
  }

  /* ----------------------------- Tiles / UI ----------------------------- */

  function roleLabel(role) {
    return (window.__roles && window.__roles[role] && window.__roles[role].label) || role || '';
  }

  function addSelfTile() {
    const stage = $('conf-stage');
    const tile = document.createElement('div');
    tile.className = 'tile tile-self';
    tile.id = 'tile-self';
    tile.innerHTML = `
      <video id="self-video" autoplay playsinline muted></video>
      <div class="tile-label"><span class="tile-name">${session.name} (You)</span>
        <span class="tile-role">${roleLabel(session.role)}</span></div>
      <div class="tile-badges"><span id="self-mic" class="tbadge"></span></div>`;
    stage.appendChild(tile);
    $('self-video').srcObject = localStream;
    refreshSelfBadges();
  }

  function addRemoteTile(peerId, info) {
    if ($(`tile-${peerId}`)) return;
    const stage = $('conf-stage');
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.id = `tile-${peerId}`;
    const host = current && current.isHost
      ? `<div class="tile-host">
           <button class="thbtn" data-mute="${peerId}" title="Mute participant">${svg('mic_off')}Mute</button>
           <button class="thbtn thbtn-rm" data-remove="${peerId}" title="Remove participant">${svg('remove')}Remove</button>
         </div>`
      : '';
    tile.innerHTML = `
      <video id="vid-${peerId}" autoplay playsinline></video>
      <div class="tile-label"><span class="tile-name">${info.name || 'Participant'}</span>
        <span class="tile-role">${roleLabel(info.role)}</span></div>
      ${host}`;
    stage.appendChild(tile);
    const v = $(`vid-${peerId}`);
    if (peers[peerId]) v.srcObject = peers[peerId].stream;

    if (current && current.isHost) {
      tile.querySelector('[data-mute]').onclick = () => socket.emit('conf:host-mute', { target: peerId });
      tile.querySelector('[data-remove]').onclick = () => socket.emit('conf:host-remove', { target: peerId });
    }
  }

  function refreshSelfBadges() {
    const b = $('self-mic');
    if (b) b.innerHTML = `${svg(micOn ? 'mic' : 'mic_off')}${svg(camOn ? 'videocam' : 'videocam_off')}`;
  }

  function updateCount(n) { $('conf-count').textContent = `${n} in room`; }

  /* ----------------------------- Controls ----------------------------- */

  function toggleMic() {
    micOn = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    updateButtons(); refreshSelfBadges();
  }
  function toggleCam() {
    camOn = !camOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
    updateButtons(); refreshSelfBadges();
  }

  async function toggleShare() {
    if (!sharing) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (_) { return; }
      const track = screenStream.getVideoTracks()[0];
      replaceVideoTrack(track);
      track.onended = stopShare;
      sharing = true;
    } else {
      stopShare();
    }
    updateButtons();
  }
  function stopShare() {
    if (screenStream) { screenStream.getTracks().forEach((t) => t.stop()); screenStream = null; }
    const cam = localStream.getVideoTracks()[0];
    if (cam) replaceVideoTrack(cam);
    sharing = false;
    updateButtons();
  }
  function replaceVideoTrack(track) {
    Object.values(peers).forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(track);
    });
    $('self-video').srcObject = new MediaStream([track, ...localStream.getAudioTracks()]);
  }

  function toggleRecording() {
    recording = !recording;
    socket.emit('conf:rec', { hearingId: current.hearingId, on: recording });
    if (recording) startRecording(); else stopRecording();
  }
  function setRecIndicator(on) {
    recording = on;                       // non-host peers: indicator only
    $('conf-rec').classList.toggle('hidden', !on);
    updateButtons();
  }

  /* ---- Actual capture: composite canvas video + mixed audio -> MediaRecorder ---- */
  function pickMime() {
    const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    return '';
  }
  function recConnect(stream) {            // add a stream's audio to the mix (once)
    if (!recAudioCtx || !recDest || !stream || recConnected.has(stream.id)) return;
    if (!stream.getAudioTracks().length) return;
    try { recAudioCtx.createMediaStreamSource(stream).connect(recDest); recConnected.add(stream.id); } catch (_) {}
  }
  function startRecording() {
    if (mediaRecorder) return;
    if (!window.MediaRecorder) { toast('Recording not supported in this browser.'); return; }
    // 1) Composite video onto a canvas (auto-includes anyone whose tile is on screen)
    recCanvas = document.createElement('canvas');
    recCanvas.width = 1280; recCanvas.height = 720;
    recCtx = recCanvas.getContext('2d');
    const draw = () => {
      const vids = Array.from($('conf-stage').querySelectorAll('video')).filter((v) => v.videoWidth > 0);
      const ctx = recCtx, W = recCanvas.width, Hh = recCanvas.height;
      ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, Hh);
      const n = Math.max(1, vids.length);
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const cw = W / cols, ch = Hh / rows;
      vids.forEach((v, i) => {
        const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
        const vr = v.videoWidth / v.videoHeight, cr = cw / ch;
        let dw = cw, dh = ch, dx = cx, dy = cy;
        if (vr > cr) { dh = ch; dw = ch * vr; dx = cx - (dw - cw) / 2; }
        else { dw = cw; dh = cw / vr; dy = cy - (dh - ch) / 2; }
        try { ctx.drawImage(v, dx, dy, dw, dh); } catch (_) {}
        ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 4; ctx.strokeRect(cx, cy, cw, ch);
      });
      recRAF = requestAnimationFrame(draw);
    };
    draw();
    const canvasStream = recCanvas.captureStream(25);
    // 2) Mix audio from self + all peers (and late joiners via recConnect in ontrack)
    recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    recDest = recAudioCtx.createMediaStreamDestination();
    recConnected = new Set();
    if (localStream) recConnect(localStream);
    Object.values(peers).forEach((p) => recConnect(p.stream));
    // 3) Combine + record
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
    recMime = pickMime() || 'video/webm';
    recChunks = [];
    try {
      mediaRecorder = new MediaRecorder(mixed, recMime ? { mimeType: recMime } : undefined);
    } catch (e) { toast('Could not start recorder: ' + e.message); cleanupRec(); return; }
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = finalizeRecording;
    recStart = new Date();
    mediaRecorder.start(1000);
    toast('Recording started.');
  }
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch (_) { cleanupRec(); } }
    else cleanupRec();
  }
  function cleanupRec() {
    if (recRAF) { cancelAnimationFrame(recRAF); recRAF = 0; }
    if (recAudioCtx) { try { recAudioCtx.close(); } catch (_) {} recAudioCtx = null; }
    recDest = null; recConnected = null; recCanvas = null; recCtx = null;
  }
  function finalizeRecording() {
    const blob = new Blob(recChunks, { type: recMime });
    cleanupRec(); mediaRecorder = null;
    if (!blob.size) { toast('Recording was empty.'); return; }
    const ts = (recStart || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `hearing-${String(current && current.hearingNumber || 'session').replace(/\s+/g, '_')}-${ts}.webm`;
    // (a) local download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast(`Recording saved: ${name}`);
    // (b) upload to server so it's persisted server-side too
    fetch(`/api/recordings/${encodeURIComponent(current.hearingId)}?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': blob.type || 'video/webm' }, body: blob,
    }).then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => toast(`Uploaded to server (${Math.round((d.bytes || blob.size) / 1024)} KB).`))
      .catch(() => {});
  }

  function updateButtons() {
    setBtn('c-mic', micOn, svg(micOn ? 'mic' : 'mic_off'), micOn ? 'Mute' : 'Unmute');
    setBtn('c-cam', camOn, svg(camOn ? 'videocam' : 'videocam_off'), camOn ? 'Stop Video' : 'Start Video');
    setBtn('c-share', sharing, svg('screen_share'), sharing ? 'Stop Share' : 'Share');
    setBtn('c-chat', false, svg('chat'), 'Chat');
    setBtn('c-rec', recording, svg('record'), recording ? 'Stop Rec' : 'Record');
    setBtn('c-leave', false, svg('call_end'), 'Leave');
    // Host-only record button
    $('c-rec').classList.toggle('hidden', !(current && current.isHost));
  }
  function setBtn(id, active, icon, label) {
    const el = $(id);
    if (!el) return;
    const isToggle = id === 'c-share' || id === 'c-rec';
    el.classList.toggle('active', isToggle && !!active);
    // Only mic/cam turn red when off
    if (id === 'c-mic' || id === 'c-cam') el.classList.toggle('off', !active);
    el.innerHTML = `${icon}<span>${label}</span>`;
  }

  /* ----------------------------- Captions / translation ----------------------------- */

  function toggleCaptions() {
    captionsOn = !captionsOn;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (captionsOn && !SR) {
      captionsOn = false;
      toast('Live captions need Chrome or Edge (Web Speech API).');
      return;
    }
    setBtn('c-cc', captionsOn, svg('chat'), captionsOn ? 'Captions On' : 'Captions');
    $('conf-captions').classList.toggle('hidden', !captionsOn);
    if (captionsOn) startRecognition(); else stopRecognition();
  }

  function startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || recognition) return;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      let interim = '', finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) socket.emit('conf:caption', { hearingId: current.hearingId, text: interim, final: false });
      if (finalText) socket.emit('conf:caption', { hearingId: current.hearingId, text: finalText.trim(), final: true });
    };
    recognition.onend = () => { if (captionsOn) { try { recognition.start(); } catch (_) {} } };
    try { recognition.start(); } catch (_) {}
  }
  function stopRecognition() {
    if (!recognition) return;
    const r = recognition; recognition = null;
    try { r.onend = null; r.stop(); } catch (_) {}
  }

  function showCaption({ from, role, text, final }) {
    if (!captionsOn) { $('conf-captions').classList.remove('hidden'); captionsOn = true; setBtn('c-cc', true, svg('chat'), 'Captions On'); }
    const orig = $('cap-original');
    orig.textContent = `${from}: ${text}`;
    // Auto-hide the overlay after a pause of silence
    clearTimeout(capHideTimer);
    capHideTimer = setTimeout(() => { orig.textContent = ''; $('cap-translated').textContent = ''; }, 6000);
    // Interpreter assist: translate FINAL captions if a target language is chosen
    const tr = $('cap-translated');
    if (final && capLang) {
      fetch('/api/ai/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, to: capLang }) })
        .then((r) => r.json()).then((d) => {
          tr.classList.remove('hidden');
          tr.textContent = `↳ ${d.translation}`;
        }).catch(() => {});
    } else if (!capLang) {
      tr.classList.add('hidden');
    }
  }

  /* ----------------------------- Chat ----------------------------- */

  function addChat({ from, role, text, ts }) {
    const ul = $('conf-chat-msgs');
    const li = document.createElement('li');
    const mine = from === session.name;
    li.className = mine ? 'me' : '';
    const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<div class="cm-head"><b>${from}</b> <span class="cm-role">${roleLabel(role)}</span> <span class="cm-time">${time}</span></div><div class="cm-text"></div>`;
    li.querySelector('.cm-text').textContent = text;
    ul.appendChild(li);
    ul.scrollTop = ul.scrollHeight;
  }

  /* ----------------------------- Wire controls ----------------------------- */

  function wire() {
    $('c-mic').onclick = toggleMic;
    $('c-cam').onclick = toggleCam;
    $('c-share').onclick = toggleShare;
    $('c-rec').onclick = toggleRecording;
    $('c-leave').onclick = leave;
    $('c-cc').onclick = toggleCaptions;
    $('cap-lang').onchange = (e) => {
      capLang = e.target.value;
      if (!capLang) $('cap-translated').classList.add('hidden');
    };
    $('c-chat').onclick = () => $('conf-chat').classList.toggle('hidden');
    $('conf-chat-form').onsubmit = (e) => {
      e.preventDefault();
      const input = $('conf-chat-input');
      const text = input.value.trim();
      if (!text || !current) return;
      socket.emit('conf:chat', { hearingId: current.hearingId, text });
      input.value = '';
    };
  }

  function toast(msg) {
    if (window.VWRToast) return window.VWRToast(msg, 'info');
    console.log('[conf]', msg);
  }

  // Cache role labels for tile/chat display
  fetch('/api/directory').then((r) => r.json()).then((d) => { window.__roles = d.roles; }).catch(() => {});

  document.addEventListener('DOMContentLoaded', wire);
  if (document.readyState !== 'loading') wire();

  window.VWRConf = { join, leave };
})();
```

## `README.md`

````markdown
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
````

---

# PART 2 — REFERENCE (how it works · for understanding & verification)

Part 1 is the source of truth. The following describes intent, behavior, and the
acceptance criteria to verify the reproduction.


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
server.js               # Express + Socket.io: state, status engine, REST, signaling
public/
  index.html            # SPA shell: login, dashboards, conference overlay
  app.js                # VWR client: role-based rendering, actions, search/sort/filter
  conference.js         # WebRTC mesh client: media, controls, chat, host controls, recording
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
