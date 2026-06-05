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

function snapshot() {
  recomputeAll();
  return {
    hearings,
    auditLog: auditLog.slice(0, 50),
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
  res.json({ directory, roles: ROLES });
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

  socket.on('disconnect', () => leaveConf(socket));
});

server.listen(PORT, () => {
  console.log(`\n  NYS Virtual Waiting Room running at  http://localhost:${PORT}\n`);
});
```

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
  <!-- ============ LOGIN ============ -->
  <section id="login" class="login-screen" aria-labelledby="login-title">
    <div class="login-card">
      <div class="seal" aria-hidden="true">NYS</div>
      <h1 id="login-title">Virtual Waiting Room</h1>
      <p class="login-sub">NYS ITS · Integrated Eligibility System (IES) · Fair Hearings</p>

      <label for="user-select" class="field-label">Sign in via ITS Identity (SSO)</label>
      <select id="user-select" class="select" aria-describedby="login-hint"></select>
      <p id="login-hint" class="hint">Demo SSO — your role &amp; permissions are derived from the IAM assertion.</p>

      <nys-button id="login-btn" fullWidth label="Sign In via SSO" prefixIcon="lock_filled"></nys-button>

      <details class="sso-note">
        <summary>About authentication</summary>
        <p>In production this screen is replaced by ITS IAM using <strong>SAML 2.0 / OAuth / OpenID Connect</strong> single sign-on. Role and party-of-interest claims flow from the calling IES application.</p>
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
        <nys-button id="reset-btn" variant="outline" inverted size="sm" label="Reset" prefixIcon="refresh" title="Reset demo data"></nys-button>
        <nys-button id="logout-btn" variant="outline" inverted size="sm" label="Sign out" prefixIcon="close"></nys-button>
      </div>
    </header>

    <main id="main" class="content" role="main">
      <!-- Toolbar: search + sort (spec §3, §4) -->
      <div id="toolbar" class="toolbar">
        <div class="toolbar-left">
          <div class="search-wrap">
            <nys-icon name="search" size="sm" class="search-icon" aria-hidden="true"></nys-icon>
            <input id="search" class="input has-icon" type="search" placeholder="Search hearing #, name, type, agency…" aria-label="Search hearings" />
          </div>
          <select id="sort" class="select select-sm" aria-label="Sort hearings">
            <option value="time">Sort: Scheduled time</option>
            <option value="appellant">Sort: Appellant name</option>
            <option value="status">Sort: Waiting room status</option>
            <option value="agency">Sort: Agency</option>
          </select>
          <select id="filter-status" class="select select-sm" aria-label="Filter by status">
            <option value="">All statuses</option>
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
      <div class="conf-stage" id="conf-stage" aria-label="Participant video"></div>

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
      <button id="c-chat" class="cbtn" type="button"><span>Chat</span></button>
      <button id="c-rec" class="cbtn hidden" type="button"><span>Record</span></button>
      <button id="c-leave" class="cbtn cbtn-leave" type="button"><span>Leave</span></button>
    </div>
  </div>

  <!-- Toast container -->
  <div id="toasts" class="toasts" aria-live="assertive"></div>

  <script src="/socket.io/socket.io.js"></script>
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

  const STATUS_META = {
    not_checked_in: { label: 'Not Checked In',    cls: 'st-none',     icon: 'remove' },
    not_ready:      { label: 'Not Ready',         cls: 'st-notready', icon: 'progress_activity' },
    ready:          { label: 'Ready for Hearing', cls: 'st-ready',    icon: 'check_circle' },
    called:         { label: 'Called',            cls: 'st-called',   icon: 'phone_in_talk' },
    recalled:       { label: 'Recalled',          cls: 'st-recalled', icon: 'refresh' },
    closed:         { label: 'Closed',            cls: 'st-closed',   icon: 'check' },
  };

  /* -------------------- Login -------------------- */

  async function initLogin() {
    const res = await fetch('/api/directory');
    const data = await res.json();
    ROLES = data.roles;
    const sel = $('#user-select');
    sel.innerHTML = data.directory
      .map((u) => `<option value="${u.userId}">${u.name} — ${ROLES[u.role].label}</option>`)
      .join('');

    // Populate status filter
    const fs = $('#filter-status');
    Object.entries(STATUS_META).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = v.label; fs.appendChild(o);
    });
  }

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
    $('#who-role').textContent = session.roleLabel;
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
    el.textContent = ok ? '● Live' : '● Offline';
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
      board.innerHTML = `<div class="empty">No hearings match your view.</div>`;
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
      case 'hearing_officer': return 'My Assigned Hearings';
      case 'supervisor':
      case 'admin_staff': return 'All Hearings — Oversight Dashboard';
      case 'interpreter': return 'Hearings I Support';
      default: return 'My Hearings';
    }
  }

  function statusBadge(status) {
    const m = STATUS_META[status] || { label: status, cls: '', icon: 'info' };
    return `<span class="badge status ${m.cls}"><nys-icon name="${m.icon}" size="sm" aria-hidden="true"></nys-icon>${m.label}</span>`;
  }

  function me(h) {
    return h.participants.find((p) => p.userId === session.sub);
  }

  /* ---- Participant-style card (appellant, rep, agency, witness, interpreter) ---- */

  function renderCard(h, role) {
    const mine = me(h);
    const limited = role === 'interpreter' || role.endsWith('_witness'); // limited view (spec §6d.v, §6 witness)
    const isOfficer = role === 'hearing_officer';

    const participantsHtml = limited
      ? `<p class="limited-note">Participant details are limited for your role.</p>`
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
          <span><b>Appellant:</b> ${h.appellantName}</span>
          <span><b>Time:</b> ${h.scheduledTime}</span>
          <span><b>Aid:</b> ${h.categoryOfAid}</span>
          ${h.disposition ? `<span><b>Disposition:</b> ${h.disposition}</span>` : ''}
        </div>
        ${myControls}
        ${officerControls}
        <div class="card-participants">${participantsHtml}</div>
        ${h.conferenceUrl ? `<button class="conf-link" data-act="joinconf" data-h="${h.id}" data-hn="${h.hearingNumber}" data-host="${isOfficer && h.assignedOfficerId === session.sub ? '1' : '0'}"><nys-icon name="phone_in_talk" size="sm"></nys-icon> Join Virtual Hearing (In-house Video)</button>` : ''}
      </article>`;
  }

  function availBadge(p) {
    if (p.denied) return `<nys-badge intent="error" size="sm" label="Removed" prefixIcon="cancel"></nys-badge>`;
    if (!p.checkedIn) return `<nys-badge intent="neutral" size="sm" label="Not checked in"></nys-badge>`;
    return p.status === 'available'
      ? `<nys-badge intent="success" size="sm" label="Available" prefixIcon="check_circle"></nys-badge>`
      : `<nys-badge intent="warning" size="sm" label="Unavailable"></nys-badge>`;
  }

  function renderParticipantList(h, showDeny) {
    return `
      <div class="plist-title">Participants</div>
      <ul class="plist">
        ${h.participants.map((p) => `
          <li class="${p.denied ? 'denied' : ''}">
            <nys-icon name="account_circle" size="md" class="picon" aria-hidden="true"></nys-icon>
            <span class="pname">${p.name}</span>
            <span class="prole">${ROLES[p.role]?.label || p.role}</span>
            <span class="pstat">${availBadge(p)}</span>
            ${p.checkInTime ? `<span class="ptime">${fmtTime(p.checkInTime)}</span>` : ''}
            ${showDeny && p.checkedIn && p.role !== 'hearing_officer'
              ? `<button class="btn btn-danger btn-xs" data-act="deny" data-h="${h.id}" data-u="${p.userId}"><nys-icon name="cancel" size="xs"></nys-icon>Deny</button>` : ''}
          </li>`).join('')}
      </ul>`;
  }

  function renderMyControls(h, mine) {
    const closed = h.status === 'closed';
    if (closed) return `<div class="my-controls"><span class="muted">This hearing is closed.</span></div>`;
    if (!mine.checkedIn) {
      return `<div class="my-controls">
        <nys-button data-act="checkin" data-h="${h.id}" data-u="${mine.userId}" label="Check In" prefixIcon="check_circle"></nys-button>
      </div>`;
    }
    return `
      <div class="my-controls">
        <span class="muted">You're checked in${mine.checkInTime ? ' at ' + fmtTime(mine.checkInTime) : ''}.</span>
        <div class="seg">
          <button class="btn btn-toggle ${mine.status === 'available' ? 'on' : ''}" data-act="avail" data-h="${h.id}" data-u="${mine.userId}" data-s="available">Available</button>
          <button class="btn btn-toggle ${mine.status === 'unavailable' ? 'on' : ''}" data-act="avail" data-h="${h.id}" data-u="${mine.userId}" data-s="unavailable">Unavailable</button>
        </div>
        <nys-button data-act="checkout" data-h="${h.id}" data-u="${mine.userId}" variant="outline" size="sm" label="Check Out" prefixIcon="close"></nys-button>
      </div>`;
  }

  function renderOfficerControls(h) {
    const ready = h.status === 'ready';
    const inHearing = h.status === 'called' || h.status === 'recalled';
    const closed = h.status === 'closed';

    const officers = (window.__officers || []);
    const reassign = `
      <select class="select select-sm" data-act="reassign" data-h="${h.id}" aria-label="Reassign hearing officer">
        <option value="">Reassign to…</option>
        ${officers.filter(o => o.userId !== h.assignedOfficerId).map(o => `<option value="${o.userId}">${o.name}</option>`).join('')}
      </select>`;

    let primary = '';
    let hint = '';
    if (closed) {
      primary = `<nys-button data-act="reopen" data-h="${h.id}" variant="outline" label="Recall Hearing" prefixIcon="refresh"></nys-button>`;
    } else if (inHearing) {
      primary = `
        <nys-button data-act="start" data-h="${h.id}" label="Start / Launch Conference" prefixIcon="phone_in_talk"></nys-button>
        <button class="btn btn-danger" data-act="close" data-h="${h.id}"><nys-icon name="cancel" size="sm"></nys-icon>Close Hearing</button>`;
    } else {
      primary = `<nys-button data-act="call" data-h="${h.id}" label="Call Hearing" prefixIcon="phone_in_talk" ${ready ? '' : 'disabled'}></nys-button>`;
      if (!ready) {
        // Ready requires at least one participant checked in AND available.
        hint = `<div class="muted blockers"><nys-icon name="progress_activity" size="xs"></nys-icon> Waiting for at least one participant to check in and be available.</div>`;
      }
    }

    return `<div class="officer-controls">
      ${primary}
      ${!closed ? reassign : ''}
      ${hint}
    </div>`;
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
      return `
        <tr class="row-${h.status}">
          <td>${h.scheduledTime}</td>
          <td><b>${h.hearingNumber}</b><br><span class="muted">${h.hearingType}</span></td>
          <td>${h.appellantName}</td>
          <td>${h.agency}<br><span class="muted">${h.categoryOfAid}</span></td>
          <td>${officerName(h.assignedOfficerId)}</td>
          <td>${statusBadge(h.status)}</td>
          <td>${checkedIn}/${h.participants.length}</td>
          <td>${h.disposition || '—'}</td>
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
      <table class="sup-table">
        <thead>
          <tr><th>Time</th><th>Hearing</th><th>Appellant</th><th>Agency / Aid</th><th>Officer</th><th>Status</th><th>Checked In</th><th>Disposition</th></tr>
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
