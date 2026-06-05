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
