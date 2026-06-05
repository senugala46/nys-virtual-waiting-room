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

  function predFor(h) {
    return (state.predictions && state.predictions.perHearing && state.predictions.perHearing[h.id]) || null;
  }
  function waitChip(h) {
    const p = predFor(h);
    if (!p || h.status === 'closed') return '';
    if (p.inProgress) return `<span class="wait-chip in-progress"><nys-icon name="phone_in_talk" size="xs"></nys-icon> In progress</span>`;
    const m = p.estimatedWaitMin;
    return `<span class="wait-chip"><nys-icon name="progress_activity" size="xs"></nys-icon> Est. wait ~${m} min</span>`;
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
          ${waitChip(h)}
        </div>
        ${myControls}
        ${officerControls}
        ${isOfficer ? renderSummary(h) : ''}
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

  function renderSummary(h) {
    const has = !!h.summary;
    const hasTranscript = (h.transcript && h.transcript.length) ? `${h.transcript.length} caption lines` : 'no captions yet';
    return `
      <div class="summary-box">
        <div class="summary-head">
          <span><nys-icon name="edit_square" size="sm"></nys-icon> AI Hearing Summary</span>
          <button class="btn btn-ghost btn-xs" data-act="gensummary" data-h="${h.id}">${has ? 'Regenerate' : 'Generate'}</button>
        </div>
        ${has
          ? `<div class="summary-body">${mdLite(h.summary)}</div>`
          : `<div class="muted summary-empty">Generates a structured summary from the transcript (${hasTranscript}).</div>`}
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
          el.textContent = 'Generating…';
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
