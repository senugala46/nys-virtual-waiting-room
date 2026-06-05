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
