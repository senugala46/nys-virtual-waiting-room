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
    reqAdj: (hearingId) => { const r = prompt(t('req.adjReason'), ''); if (r !== null) socket.emit('requestAction', { hearingId, userId: session.sub, type: 'adjournment', reason: r }); },
    reqWdr: (hearingId) => { const r = prompt(t('req.wdrReason'), ''); if (r !== null) socket.emit('requestAction', { hearingId, userId: session.sub, type: 'withdrawal', reason: r }); },
    resolveReq: (hearingId, requestId, decision) => socket.emit('resolveRequest', { hearingId, requestId, decision }),
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
      loadOpenData();
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
  function evidenceFor(h) {
    return (state.evidence || []).filter((e) => e.hearingId === h.id);
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
        ${mine && !isOfficer ? renderAttendeeRequests(h, mine) : ''}
        ${officerControls}
        ${isOfficer ? renderOfficerRequests(h) : ''}
        ${isOfficer ? renderSummary(h) : ''}
        <div class="card-participants">${participantsHtml}</div>
        ${renderEvidence(h, (!!mine || isOfficer))}
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

  function renderAttendeeRequests(h, mine) {
    const canAdj = ['appellant', 'appellant_rep', 'agency_rep'].includes(mine.role);
    const canWdr = ['appellant', 'appellant_rep'].includes(mine.role);
    if (!canAdj && !canWdr) return '';
    const open = h.status !== 'closed';
    const myReqs = (h.requests || []).filter((r) => r.by.userId === mine.userId);
    const btns = open ? `
      <div class="req-actions">
        ${canAdj ? `<button class="btn btn-ghost btn-sm" data-act="reqadj" data-h="${h.id}"><nys-icon name="calendar_month" size="xs"></nys-icon> ${t('req.adjourn')}</button>` : ''}
        ${canWdr ? `<button class="btn btn-ghost btn-sm" data-act="reqwdr" data-h="${h.id}"><nys-icon name="cancel" size="xs"></nys-icon> ${t('req.withdraw')}</button>` : ''}
      </div>` : '';
    const statuses = myReqs.map((r) =>
      `<div class="req-status req-${r.status}">${t('reqtype.' + r.type)}: <b>${t('reqstatus.' + r.status)}</b></div>`).join('');
    if (!btns && !statuses) return '';
    return `<div class="requests">${btns}${statuses}</div>`;
  }

  function renderOfficerRequests(h) {
    const pending = (h.requests || []).filter((r) => r.status === 'pending');
    if (!pending.length) return '';
    return `
      <div class="officer-requests">
        <div class="or-title"><nys-icon name="notifications" size="sm"></nys-icon> ${t('req.pendingTitle')}</div>
        ${pending.map((r) => `
          <div class="or-item">
            <div class="or-info"><b>${t('reqtype.' + r.type)}</b> — ${t('req.by')} ${r.by.name} (${roleLabel(r.by.role)})${r.reason ? `<div class="or-reason">“${r.reason}”</div>` : ''}</div>
            <div class="or-btns">
              <button class="btn btn-primary btn-xs" data-act="reqgrant" data-h="${h.id}" data-r="${r.id}">${t('req.grant')}</button>
              <button class="btn btn-danger btn-xs" data-act="reqdeny" data-h="${h.id}" data-r="${r.id}">${t('req.deny')}</button>
            </div>
          </div>`).join('')}
      </div>`;
  }

  function renderEvidence(h, canUpload) {
    const items = evidenceFor(h);
    const allowUpload = canUpload && h.status !== 'closed';
    return `
      <div class="evidence">
        <div class="ev-head">
          <nys-icon name="attach_file" size="sm" aria-hidden="true"></nys-icon>
          <span>${t('ev.title')} (${items.length})</span>
          ${allowUpload ? `<button class="btn btn-ghost btn-xs" data-act="uploadev" data-h="${h.id}"><nys-icon name="upload_file" size="xs"></nys-icon> ${t('ev.upload')}</button>` : ''}
        </div>
        ${items.length
          ? `<ul class="ev-list">${items.map((e) => `
              <li>
                <nys-icon name="attach_file" size="sm" aria-hidden="true"></nys-icon>
                <a class="ev-name" href="${e.url}" target="_blank" rel="noopener" title="${e.name}">${e.name}</a>
                <span class="ev-meta">${e.uploader}${e.role ? ' · ' + roleLabel(e.role) : ''} · ${fmtBytes(e.bytes)} · ${fmtTime(e.ts)}</span>
              </li>`).join('')}</ul>`
          : `<div class="muted ev-empty">${t('ev.none')}</div>`}
      </div>`;
  }

  function uploadEvidence(file, hearingId) {
    if (!file) return;
    const q = new URLSearchParams({ name: file.name, uploader: session.name, role: session.role });
    toast(t('ev.uploading', { name: file.name }));
    fetch(`/api/evidence/${hearingId}?${q.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then((rec) => toast(t('ev.uploaded', { name: rec.name })))
      .catch((e) => toast((e && e.error) || 'Upload failed', 'error'));
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
          <td>${evidenceFor(h).length || '—'}</td>
          <td>${wait}</td>
          <td>${(() => { const pr = (h.requests || []).find((r) => r.status === 'pending'); return pr ? `<span class="req-flag">⏳ ${t('reqtype.' + pr.type)} ${t('req.requested')}</span> ` : ''; })()}${h.summary ? '<nys-icon name="edit_square" size="sm" title="Summary available"></nys-icon> ' : ''}${h.disposition || '—'}</td>
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
          <tr><th>Time</th><th>Hearing</th><th>Appellant</th><th>Agency / Aid</th><th>Officer</th><th>Status</th><th>Checked In</th><th>Docs</th><th>Est. wait</th><th>Disposition</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="od-panel">
        <div class="od-head">
          <nys-icon name="language" size="sm" aria-hidden="true"></nys-icon>
          <span>${t('od.title')}</span>
          <a class="od-src" href="https://data.ny.gov/Human-Services/Supplemental-Nutrition-Assistance-Program-SNAP-Cas/dq6j-8u8z" target="_blank" rel="noopener">data.ny.gov</a>
        </div>
        <div id="od-content" class="od-content">…</div>
      </div>`;
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
      } else if (a === 'reqadj') {
        el.onclick = () => act.reqAdj(el.dataset.h);
      } else if (a === 'reqwdr') {
        el.onclick = () => act.reqWdr(el.dataset.h);
      } else if (a === 'reqgrant') {
        el.onclick = () => act.resolveReq(el.dataset.h, el.dataset.r, 'granted');
      } else if (a === 'reqdeny') {
        el.onclick = () => act.resolveReq(el.dataset.h, el.dataset.r, 'denied');
      } else if (a === 'joinconf') {
        el.onclick = () => window.VWRConf.join(el.dataset.h, el.dataset.hn, el.dataset.host === '1');
      } else if (a === 'refreshrec') {
        el.onclick = () => loadRecordings();
      } else if (a === 'uploadev') {
        el.onclick = () => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.txt,.csv,.doc,.docx,.xls,.xlsx';
          inp.onchange = () => { if (inp.files && inp.files[0]) uploadEvidence(inp.files[0], el.dataset.h); };
          inp.click();
        };
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

  /* -------------------- NYS Open Data analytics (data.ny.gov) -------------------- */

  function fmtNum(n) {
    n = +n || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(n);
  }

  function loadOpenData() {
    const el = $('#od-content');
    if (!el) return;
    fetch('/api/opendata/snap').then((r) => r.json()).then((d) => {
      const target = $('#od-content');
      if (!target) return;
      const period = (d.latestMonth ? d.latestMonth + ' ' : '') + d.year;
      const bd = d.byDistrict || [];
      const max = Math.max(1, ...bd.map((x) => x.persons));
      const bars = bd.map((x) => `
        <div class="od-bar-row">
          <span class="od-bar-label" title="${x.district}">${x.district}</span>
          <span class="od-bar"><span class="od-bar-fill" style="width:${(x.persons / max * 100).toFixed(1)}%"></span></span>
          <span class="od-bar-val">${fmtNum(x.persons)}</span>
        </div>`).join('');

      const tr = d.trend || [];
      const tmax = Math.max(1, ...tr.map((p) => p.persons));
      const tmin = Math.min(tmax, ...tr.map((p) => p.persons));
      const W = 280, H = 64, pad = 6;
      const pts = tr.map((p, i) => {
        const x = tr.length > 1 ? pad + i * (W - 2 * pad) / (tr.length - 1) : W / 2;
        const y = H - pad - ((p.persons - tmin) / Math.max(1, tmax - tmin)) * (H - 2 * pad);
        return `${x.toFixed(0)},${y.toFixed(0)}`;
      }).join(' ');
      const spark = tr.length
        ? `<svg class="od-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--nys-blue)" stroke-width="2.5"/></svg>
           <div class="od-trend-x">${tr.map((p) => `<span>${(p.month || '').slice(0, 3)}</span>`).join('')}</div>`
        : '';

      const ta = (d.taShare && d.taShare.ta) || 0, nonta = (d.taShare && d.taShare.nonta) || 0;
      const tot = Math.max(1, ta + nonta), taPct = Math.round(ta / tot * 100);
      const share = `
        <div class="od-share-bar"><span style="width:${taPct}%"></span></div>
        <div class="od-share-legend"><b>${taPct}%</b> ${t('od.ta')} (${fmtNum(ta)}) · ${100 - taPct}% ${t('od.nonta')} (${fmtNum(nonta)})</div>`;

      target.innerHTML = `
        ${d.offline ? `<div class="od-offline">${t('od.offline')}</div>` : ''}
        <div class="od-grid">
          <div class="od-card">
            <div class="od-card-title">${t('od.byDistrict', { period })}</div>
            ${bars}
          </div>
          <div class="od-card">
            <div class="od-card-title">${t('od.trend', { year: d.year })}</div>
            ${spark}
            <div class="od-card-title" style="margin-top:12px">${t('od.taShare', { period })}</div>
            ${share}
          </div>
        </div>
        <div class="od-foot">${t('od.source')}: ${d.source}</div>`;
    }).catch(() => { const x = $('#od-content'); if (x) x.textContent = 'Could not load open data.'; });
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
