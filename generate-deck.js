/* Generates VWR-Pitch-Deck.pptx — run: node generate-deck.js
 * Diagrams (use case, architecture, flow, conferencing, AI) are drawn as native
 * PowerPoint shapes so they're editable in PowerPoint/Keynote/Google Slides. */
const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';            // 13.333" x 7.5"
pptx.author = 'Hackathon Team';
pptx.company = 'NYS ITS';
pptx.title = 'NYS Virtual Waiting Room';

const W = 13.333, H = 7.5;
const NAVY='154973', NAVYDK='0E324F', GOLD='FACE00', BLUE='457AA5', BLUELT='CDDDE9',
      GREEN='1A8A36', AMBER='B29200', PURPLE='6D4CA8', RED='D22730', GREY='4A4D4F',
      LIGHT='F6F6F6', LINE='D0D0CE', WHITE='FFFFFF', INK='1B1B1B';
const FONT='Arial';
const S = pptx.ShapeType;

/* ---------- helpers ---------- */
function header(slide, title, kicker) {
  slide.background = { color: WHITE };
  slide.addShape(S.rect, { x:0, y:0, w:W, h:0.9, fill:{color:NAVY}, line:{type:'none'} });
  slide.addShape(S.rect, { x:0, y:0.9, w:W, h:0.06, fill:{color:GOLD}, line:{type:'none'} });
  slide.addText(title, { x:0.5, y:0.06, w:11.5, h:0.78, color:WHITE, fontSize:24, bold:true, valign:'middle', fontFace:FONT });
  if (kicker) slide.addText(kicker, { x:0.5, y:0.95, w:12.3, h:0.4, color:GREY, fontSize:13, italic:true, fontFace:FONT });
  slide.addText('NYS Virtual Waiting Room  ·  Hackathon 2026', { x:0.5, y:7.05, w:12.3, h:0.35, color:'9AA6B2', fontSize:9, fontFace:FONT });
}
function box(slide, x, y, w, h, text, o={}) {
  slide.addText(text, {
    shape: o.shape||S.roundRect, x, y, w, h, rectRadius:0.06,
    fill: o.fill ? {color:o.fill} : {color:WHITE},
    line: { color:o.line||NAVY, width:o.lw||1, dashType:o.dash||'solid' },
    color: o.color||NAVY, fontSize:o.fontSize||11, bold:o.bold||false,
    align:'center', valign:'middle', fontFace:FONT, lineSpacingMultiple:0.9,
  });
}
function arrow(slide, x1, y1, x2, y2, o={}) {
  const x=Math.min(x1,x2), y=Math.min(y1,y2), w=Math.abs(x2-x1)||0.0001, h=Math.abs(y2-y1)||0.0001;
  const flipH = x2 < x1, flipV = y2 < y1;
  slide.addShape(S.line, { x, y, w, h, flipH, flipV,
    line:{ color:o.color||GREY, width:o.width||1.75, endArrowType:o.end||'triangle', beginArrowType:o.begin||'none', dashType:o.dash||'solid' } });
}
function bullets(slide, x, y, w, h, items, o={}) {
  slide.addText(items.map(t => ({ text:t, options:{ bullet:{code:'2022'}, color:o.color||INK, fontSize:o.fontSize||14, paraSpaceAfter:8 } })),
    { x, y, w, h, valign:'top', fontFace:FONT });
}

/* ============================================================ 1. TITLE */
let s = pptx.addSlide();
s.background = { color: NAVY };
s.addShape(S.rect, { x:0, y:3.05, w:W, h:0.07, fill:{color:GOLD}, line:{type:'none'} });
s.addShape(S.ellipse, { x:0.7, y:0.7, w:1.0, h:1.0, fill:{color:GOLD}, line:{type:'none'} });
s.addText('NYS', { x:0.7, y:0.7, w:1.0, h:1.0, align:'center', valign:'middle', bold:true, color:NAVYDK, fontSize:18, fontFace:FONT });
s.addText('Virtual Waiting Room', { x:0.7, y:3.2, w:12, h:1.0, color:WHITE, fontSize:44, bold:true, fontFace:FONT });
s.addText('Presence-aware fair-hearing flow + in-house video conferencing for New York State',
  { x:0.72, y:4.25, w:11.5, h:0.7, color:'CDDDE9', fontSize:18, fontFace:FONT });
s.addText('OTDA · DOH · OCFS   |   Integrated Eligibility System (IES)   |   Built on the NYS Design System',
  { x:0.72, y:5.0, w:12, h:0.5, color:'9AA6B2', fontSize:13, fontFace:FONT });

/* ============================================================ 2. PROBLEM */
s = pptx.addSlide();
header(s, 'The Problem', 'WebEx gives you a room — not a hearing workflow');
bullets(s, 0.6, 1.6, 6.1, 5, [
  'NYS runs virtual fair hearings for OTDA, DOH & OCFS on Cisco WebEx/CMR.',
  'WebEx provides a generic "waiting room" + "meeting room" — but cannot record PRESENCE.',
  'No way to know who has checked in or who is ready for the hearing.',
  'No rule that a hearing only starts when ALL required parties — including the judge — are available.',
  'Judges get no roster; supervisors get no oversight; nobody gets an audit trail.',
  'Today this is run by phone calls, spreadsheets, and guesswork.',
], { fontSize:14 });
box(s, 7.1, 1.7, 5.6, 1.2, 'Appellant logs in to a blank waiting room —\nIs the interpreter here? Is the judge ready?', { fill:LIGHT, line:LINE, color:INK, fontSize:13 });
box(s, 7.1, 3.05, 5.6, 1.2, 'Judge has no list of who is present\nand cannot tell when to begin.', { fill:LIGHT, line:LINE, color:INK, fontSize:13 });
box(s, 7.1, 4.4, 5.6, 1.2, 'Supervisor manages 60+ hearings/day\nwith zero real-time visibility.', { fill:LIGHT, line:LINE, color:INK, fontSize:13 });
box(s, 7.1, 5.75, 5.6, 0.8, 'Result: delays, no-shows, no audit, poor access to justice.', { fill:RED, line:RED, color:WHITE, bold:true, fontSize:13 });

/* ============================================================ 3. SOLUTION */
s = pptx.addSlide();
header(s, 'What We Built', 'A complete, working app — two halves, zero external services');
box(s, 0.6, 1.6, 6.0, 0.6, 'Virtual Waiting Room', { fill:NAVY, line:NAVY, color:WHITE, bold:true, fontSize:15 });
bullets(s, 0.8, 2.35, 5.7, 4.4, [
  'Role-based access for 9 hearing roles (SSO-driven).',
  'Live check-in, availability & presence tracking.',
  'Readiness state machine gates when a hearing can start.',
  'Judge controls: call/recall, deny, start, reassign, close.',
  'Supervisor oversight: search, sort, filter, live statuses, recordings.',
  'Reporting, audit log, and a multilingual UI (12 languages + English, RTL).',
], { fontSize:13 });
box(s, 6.8, 1.6, 6.0, 0.6, 'In-house Video + AI', { fill:GREEN, line:GREEN, color:WHITE, bold:true, fontSize:15 });
bullets(s, 7.0, 2.35, 5.7, 4.4, [
  'Peer-to-peer WebRTC — built by us, no third-party vendor.',
  'Multi-party video, mute, camera, screen share, chat.',
  'Host (judge) controls: mute or remove a participant.',
  'Live captions + interpreter translation; AI hearing summaries.',
  'Recording saved server-side (playback in supervisor view).',
  'Replaces Cisco WebEx/CMR with NYS-hosted video.',
], { fontSize:13 });

/* ============================================================ 4. USE CASE DIAGRAM */
s = pptx.addSlide();
header(s, 'Use Case Diagram', 'Actors, the system boundary, and what each role can do');
// system boundary
slide_boundary: {
  s.addShape(S.roundRect, { x:4.15, y:1.45, w:5.05, h:5.25, rectRadius:0.04, fill:{color:'F7FAFD'}, line:{color:NAVY, width:1.5} });
  s.addText('Virtual Waiting Room System', { x:4.15, y:1.5, w:5.05, h:0.4, align:'center', color:NAVY, bold:true, fontSize:12, fontFace:FONT });
}
const uc = (x,y,t)=>box(s, x, y, 2.25, 0.62, t, { shape:S.ellipse, fill:WHITE, line:BLUE, color:NAVY, fontSize:9.5 });
uc(4.35,1.95,'Check In / Out');
uc(4.35,2.72,'Set Availability');
uc(4.35,3.49,'Track Presence\n& Readiness');
uc(4.35,4.26,'Search / Sort\n/ Filter');
uc(4.35,5.03,'Reporting & Audit');
uc(6.85,1.95,'Call / Recall\nHearing');
uc(6.85,2.72,'Start Conference');
uc(6.85,3.49,'Manage / Deny\nParticipants');
uc(6.85,4.26,'Oversight\nDashboard');
uc(6.85,5.03,'Join Video\nHearing');
// actors (left = parties, right = staff)
const actor=(x,y,t,fill)=>box(s,x,y,2.5,0.5,t,{fill:fill||BLUELT,line:NAVY,color:NAVY,fontSize:10,bold:true});
actor(0.5,1.7,'Appellant / Rep');
actor(0.5,2.5,'Appellant Witness');
actor(0.5,3.3,'Interpreter');
actor(0.5,4.1,'Agency Rep / Witness');
actor(10.5,1.7,'Hearing Officer (ALJ)', GOLD);
actor(10.5,2.5,'Supervisor / Clerk', GOLD);
actor(10.5,3.3,'Administrative Staff', GOLD);
// system actors bottom
actor(2.6,6.85,'ITS IAM (SSO)','E9EEF4');
actor(8.2,6.85,'IES System','E9EEF4');
// associations (actor -> boundary edge)
[1.95,2.75,3.55,4.35].forEach(y=>arrow(s,3.0,y,4.15,y,{end:'none',color:GREY,width:1}));
[1.95,2.75,3.55].forEach(y=>arrow(s,10.5,y,9.2,y,{end:'none',color:GREY,width:1}));
arrow(s,3.85,6.85,4.6,5.7,{end:'none',color:GREY,width:1});
arrow(s,9.45,6.85,8.7,5.7,{end:'none',color:GREY,width:1});

/* ============================================================ 5. ARCHITECTURE */
s = pptx.addSlide();
header(s, 'System Architecture', 'One Node process · real-time state broadcast · peer-to-peer video');
// clients
s.addShape(S.roundRect, { x:0.6, y:1.45, w:8.4, h:1.5, rectRadius:0.04, fill:{color:'F7FAFD'}, line:{color:NAVY,width:1.5} });
s.addText('Browser Clients  (multi-tab / multi-device)', { x:0.6, y:1.5, w:8.4, h:0.35, align:'center', color:NAVY, bold:true, fontSize:12, fontFace:FONT });
box(s,0.9,1.95,2.5,0.85,'app.js\nVWR UI (role-based)',{fill:WHITE,line:BLUE,fontSize:10});
box(s,3.6,1.95,2.5,0.85,'conference.js\nWebRTC client',{fill:WHITE,line:BLUE,fontSize:10});
box(s,6.3,1.95,2.5,0.85,'NYS Design System\nweb components',{fill:WHITE,line:BLUE,fontSize:10});
// server
s.addShape(S.roundRect, { x:0.6, y:3.55, w:8.4, h:2.0, rectRadius:0.04, fill:{color:LIGHT}, line:{color:NAVY,width:1.5} });
s.addText('Node.js — Express + Socket.io  (single process)', { x:0.6, y:3.6, w:8.4, h:0.35, align:'center', color:NAVY, bold:true, fontSize:12, fontFace:FONT });
box(s,0.9,4.05,1.9,1.2,'REST API\n/login\n/directory\n/report',{fill:WHITE,line:BLUE,fontSize:9.5});
box(s,2.95,4.05,1.9,1.2,'Realtime\nState Engine\n(status machine)',{fill:WHITE,line:BLUE,fontSize:9.5});
box(s,5.0,4.05,1.9,1.2,'WebRTC\nSignaling\n(SDP / ICE relay)',{fill:WHITE,line:BLUE,fontSize:9.5});
box(s,7.05,4.05,1.7,1.2,'Audit Log\n+ Reporting',{fill:WHITE,line:BLUE,fontSize:9.5});
// store
box(s,0.6,5.75,8.4,0.7,'In-memory Store  (seeded from IES system of record · resets on demand)',{fill:NAVYDK,line:NAVYDK,color:WHITE,fontSize:11,bold:true});
// arrows client<->server
arrow(s,4.8,2.95,4.8,3.55,{begin:'triangle',end:'triangle',color:NAVY,width:2});
s.addText('HTTPS + Socket.io\n(live state snapshots)', { x:5.0, y:3.0, w:3.4, h:0.5, color:GREY, fontSize:9, italic:true, fontFace:FONT });
arrow(s,4.8,5.55,4.8,5.75,{end:'triangle',color:NAVY,width:2});
// P2P media
arrow(s,2.15,1.95,3.6,1.95,{begin:'triangle',end:'triangle',color:GREEN,width:2,dash:'dash'});
s.addText('WebRTC P2P media (mesh) — server only brokers signaling', { x:0.9, y:1.45, w:0.1, h:0.1, color:GREEN, fontSize:1, fontFace:FONT });
// integration seams
s.addShape(S.roundRect, { x:9.3, y:1.45, w:3.4, h:5.0, rectRadius:0.04, fill:{color:WHITE}, line:{color:GREY,width:1.25,dashType:'dash'} });
s.addText('[INTEGRATION] Seams', { x:9.3, y:1.5, w:3.4, h:0.4, align:'center', color:GREY, bold:true, fontSize:12, fontFace:FONT });
bullets(s, 9.55, 2.05, 3.0, 4.2, [
  'ITS IAM — SAML2 / OAuth / OIDC single sign-on',
  'IES — read hearing & participant data',
  'IES — write back status / officer / participants',
  'Cisco WebEx / CMR — replaced by in-house WebRTC',
  'All open, secure REST / WebSocket standards',
], { fontSize:11, color:GREY });
s.addText('Note: green dashed link = peer-to-peer audio/video between clients.', { x:0.6, y:6.6, w:8.4, h:0.3, color:GREEN, fontSize:10, italic:true, fontFace:FONT });

/* ============================================================ 6. FLOW */
s = pptx.addSlide();
header(s, 'Status Flow & User Journey', 'A hearing cannot start until every required party is ready');
const st=(x,t,fill)=>box(s,x,2.0,2.15,0.95,t,{fill,line:fill,color:WHITE,bold:true,fontSize:12});
st(0.5,'Not\nChecked In','8A96A3');
st(3.0,'Not Ready', AMBER);
st(5.5,'Ready', GREEN);
st(8.0,'Called', BLUE);
st(10.5,'Closed', GREY);
[2.65,5.15,7.65,10.15].forEach(x=>arrow(s,x,2.48,x+0.35,2.48,{color:NAVY,width:2}));
const cap=(x,t)=>s.addText(t,{x,y:3.0,w:2.5,h:0.6,align:'center',color:GREY,fontSize:9,fontFace:FONT});
cap(0.35,'appellant / rep\nchecks in');
cap(2.85,'participant(s)\nAvailable');
cap(5.35,'Judge: Call');
cap(7.85,'Judge: Close\n(+ disposition)');
// recalled loop
box(s,8.0,4.1,2.15,0.85,'Recalled',{fill:PURPLE,line:PURPLE,color:WHITE,bold:true,fontSize:12});
arrow(s,11.0,2.95,9.6,4.1,{color:PURPLE,width:1.75,dash:'dash'});
arrow(s,9.0,4.1,8.7,2.95,{color:PURPLE,width:1.75,dash:'dash'});
s.addText('Recall a closed hearing', { x:8.0, y:4.95, w:2.3, h:0.3, align:'center', color:PURPLE, fontSize:9, italic:true, fontFace:FONT });
// journey
s.addShape(S.rect, { x:0.5, y:5.55, w:12.3, h:0.04, fill:{color:GOLD}, line:{type:'none'} });
s.addText('End-to-end journey:', { x:0.5, y:5.7, w:3, h:0.4, color:NAVY, bold:true, fontSize:13, fontFace:FONT });
s.addText('1) SSO login  →  2) Check in  →  3) Set Available  →  4) Hearing turns Ready  →  5) Judge Calls  →  6) Join in-house video  →  7) Close with disposition',
  { x:0.5, y:6.1, w:12.3, h:0.7, color:INK, fontSize:13, fontFace:FONT });

/* ============================================================ 7. CONFERENCING */
s = pptx.addSlide();
header(s, 'In-house Conferencing (WebRTC)', 'We built the video — the server only brokers signaling');
const sb=(x,t)=>box(s,x,1.8,2.0,0.9,t,{fill:WHITE,line:BLUE,fontSize:10});
sb(0.5,'Client A\njoins room');
sb(2.85,'Server adds to\nconf:<hearing>');
sb(5.2,'Server sends\npeer list');
sb(7.55,'A → Offer (SDP)\nvia server');
sb(9.9,'B → Answer\n+ ICE');
[2.5,4.85,7.2,9.55].forEach(x=>arrow(s,x,2.25,x+0.35,2.25,{color:NAVY,width:1.75}));
box(s,11.9,1.8,1.2,0.9,'P2P\nmedia',{fill:GREEN,line:GREEN,color:WHITE,bold:true,fontSize:10});
arrow(s,11.9,2.25,11.9,2.25,{color:GREEN});
arrow(s,9.9,2.7,11.9,2.7,{begin:'triangle',end:'triangle',color:GREEN,width:2,dash:'dash'});
s.addText('Once connected, audio/video flow directly peer-to-peer (no server in the media path).',
  { x:0.5, y:3.0, w:12.3, h:0.4, color:GREEN, fontSize:11, italic:true, fontFace:FONT });
// feature chips
s.addText('Features delivered:', { x:0.5, y:3.7, w:6, h:0.4, color:NAVY, bold:true, fontSize:14, fontFace:FONT });
const chips=['Multi-party video + audio','Mute / unmute','Camera on/off','Screen share','In-hearing chat','Live captions','Interpreter translation','Host: mute / remove','Recording (saved)','AI hearing summary'];
chips.forEach((c,i)=>{ const col=i%5, row=Math.floor(i/5); box(s, 0.5+col*2.55, 4.2+row*0.8, 2.4, 0.6, c, {fill:LIGHT,line:LINE,color:INK,fontSize:10}); });
box(s,0.5,6.1,12.3,0.7,'Mesh suits hearing-sized rooms (≤ ~8). Scale path: add TURN for NAT traversal + an SFU for large rooms.',{fill:'F7FAFD',line:NAVY,color:NAVY,fontSize:11});

/* ============================================================ 8. AI INVOLVEMENT */
s = pptx.addSlide();
header(s, 'AI Involvement', 'Built with AI — and four AI features now built into the product');
box(s, 0.6, 1.6, 6.0, 0.6, 'Built WITH AI  (today)', { fill:NAVY, line:NAVY, color:WHITE, bold:true, fontSize:15 });
bullets(s, 0.8, 2.35, 5.7, 2.6, [
  'Entire app — backend, real-time engine, WebRTC video, NYSDS UI — built with an AI coding agent.',
  'Hours instead of weeks, from requirements to working demo.',
  'A single reusable build-prompt (PROMPT.md) regenerates the app in any CLI.',
  'AI cross-checked design-system tokens & icons for fidelity.',
], { fontSize:13 });
box(s, 6.8, 1.6, 6.0, 0.6, 'AI IN the Product  (built)', { fill:GOLD, line:GOLD, color:NAVYDK, bold:true, fontSize:15 });
bullets(s, 7.0, 2.35, 5.7, 2.6, [
  'Live captions & transcription in the hearing (in-browser).',
  'Real-time translation assist for interpreters.',
  'Automated hearing summaries drafted for the judge.',
  'Predictive wait-times to rebalance the docket.',
], { fontSize:13, color:INK });
// pipeline
s.addShape(S.rect, { x:0.5, y:5.15, w:12.3, h:0.04, fill:{color:LINE}, line:{type:'none'} });
s.addText('Architecture already exposes the hooks AI needs:', { x:0.5, y:5.3, w:12, h:0.35, color:NAVY, bold:true, fontSize:13, fontFace:FONT });
const ai=(x,t,fill,col)=>box(s,x,5.75,2.3,0.85,t,{fill,line:fill||NAVY,color:col||WHITE,fontSize:10,bold:true});
ai(0.5,'Audio streams\n+ structured events','455A6E');
arrow(s,2.9,6.18,3.25,6.18,{color:NAVY,width:2});
ai(3.3,'AI services\n(STT / MT / LLM)', GOLD, NAVYDK);
arrow(s,5.7,6.18,6.05,6.18,{color:NAVY,width:2});
ai(6.1,'Transcript /\nCaptions', GREEN);
ai(8.5,'Translation /\nInterpreter assist', BLUE);
ai(10.9,'Summaries /\nWait-time predict', PURPLE);
s.addText('Built & demoable. Translation/summaries use a hosted model when an API key is set, with an offline fallback; captions are in-browser; wait-times are a live heuristic.', { x:6.8, y:4.8, w:6, h:0.6, color:GREY, fontSize:9.5, italic:true, fontFace:FONT });

/* ============================================================ 9. DESIGN SYSTEM & A11Y */
s = pptx.addSlide();
header(s, 'NYS Design System & Accessibility', 'On-brand, on-standard, and built for everyone');
bullets(s, 0.6, 1.7, 6.0, 5, [
  'Built on the official NYS Design System (NYSDS): @nysds/styles + @nysds/components.',
  'State-blue theme, NYS gold accent, Proxima Nova type — all via design tokens.',
  'Real components: nys-globalheader, nys-button, nys-icon, nys-badge.',
  'Multilingual UI — NYS 12-language set + English, with RTL (Arabic / Urdu / Yiddish).',
  '508 / WCAG: visible focus, contrast, semantic landmarks, responsive multi-device.',
  'AV icons (mic/camera/etc.) inlined in the same Material family, since NYSDS omits them.',
], { fontSize:14 });
box(s, 7.0, 1.8, 5.7, 0.6, 'Color tokens', { fill:NAVY, line:NAVY, color:WHITE, bold:true, fontSize:13 });
const sw=(x,c,t,col)=>box(s,x,2.55,1.85,0.8,t,{fill:c,line:c,color:col||WHITE,fontSize:10,bold:true});
sw(7.0,NAVY,'State Blue\n#154973');
sw(8.95,GOLD,'Accent Gold\n#FACE00','1B1B1B');
sw(10.9,GREEN,'Success\n#1A8A36');
sw(7.0,AMBER,'Warning\n#B29200'); s.addShape(S.rect,{x:7.0,y:3.45,w:0,h:0,line:{type:'none'}});
// move warning/danger to a second row
box(s,7.0,3.5,1.85,0.8,'Warning\n#B29200',{fill:AMBER,line:AMBER,color:WHITE,fontSize:10,bold:true});
box(s,8.95,3.5,1.85,0.8,'Danger\n#D22730',{fill:RED,line:RED,color:WHITE,fontSize:10,bold:true});
box(s,10.9,3.5,1.85,0.8,'Surface\n#FFFFFF',{fill:WHITE,line:LINE,color:INK,fontSize:10,bold:true});
box(s,7.0,4.7,5.75,1.7,'9 roles · 6-state status machine · live multi-tab sync · in-house video + recording · AI captions/translation/summaries · 13-language UI · audit + reporting — one dependency-light app.',{fill:'F7FAFD',line:NAVY,color:NAVY,fontSize:12});

/* ============================================================ 10. IMPACT */
s = pptx.addSlide();
header(s, 'Impact — Who This Really Helps', 'Not a generic tool — it touches real New Yorkers at a vulnerable moment');
function impactCard(x, y, accent, title, body) {
  const w=3.9, h=1.95;
  s.addShape(S.roundRect, { x, y, w, h, rectRadius:0.05, fill:{color:WHITE}, line:{color:LINE, width:1} });
  s.addShape(S.rect, { x, y:y+0.06, w:0.13, h:h-0.12, fill:{color:accent}, line:{type:'none'} });
  s.addText([
    { text:title+'\n', options:{ bold:true, color:NAVY, fontSize:13 } },
    { text:body, options:{ color:INK, fontSize:11 } },
  ], { x:x+0.28, y:y+0.12, w:w-0.45, h:h-0.24, valign:'top', align:'left', fontFace:FONT, lineSpacingMultiple:0.95 });
}
impactCard(0.6, 1.55, NAVY,  'Appellants & families',
  'Vulnerable New Yorkers appealing Medicaid, SNAP, child care & temporary assistance — clarity not anxiety, no wasted trips, guaranteed interpreter, 508-accessible. Access to justice.');
impactCard(4.72, 1.55, BLUE, 'Representatives & advocates',
  'Legal aid & reps see readiness in real time, manage multiple hearings, and stop losing days to adjournments from a missing party.');
impactCard(8.84, 1.55, GOLD, 'Hearing Officers (ALJs)',
  'A live roster + readiness gate; focus on one hearing at a time; start on time instead of waiting in a blank room.');
impactCard(0.6, 3.7, GREEN, 'Supervisors & clerks',
  'Day-wide oversight to rebalance dockets, with live metrics and a full audit trail for compliance.');
impactCard(4.72, 3.7, PURPLE, 'Agencies (OTDA / DOH / OCFS) & ITS',
  'In-house video = no vendor lock-in, a complete audit record, and clean integration with IES and ITS IAM.');
impactCard(8.84, 3.7, AMBER, 'New York State & taxpayers',
  'Higher throughput, fewer no-shows & adjournments, and lower third-party conferencing cost.');
box(s, 0.6, 5.95, 12.13, 0.75, 'Bottom line: better outcomes for the New Yorker on the other side of the screen — and a real tool for the people who serve them.',
  { fill:NAVYDK, line:NAVYDK, color:WHITE, bold:true, fontSize:13 });

/* ============================================================ 11. FUTURE PLANS */
s = pptx.addSlide();
header(s, 'Future Plans / Roadmap', 'From working demo to production NYS system');
// timeline arrow
s.addText('Now', { x:0.6, y:1.45, w:1, h:0.3, color:GREY, fontSize:10, bold:true, fontFace:FONT });
s.addText('Future', { x:11.8, y:1.45, w:1, h:0.3, color:GREY, fontSize:10, bold:true, align:'right', fontFace:FONT });
arrow(s, 0.6, 1.78, 12.73, 1.78, { color:GOLD, width:3, end:'triangle' });
function phaseCard(x, title, color, items) {
  const w=2.85, y=2.0, h=3.85;
  s.addShape(S.roundRect, { x, y, w, h, rectRadius:0.04, fill:{color:WHITE}, line:{color:LINE, width:1} });
  s.addText(title, { shape:S.rect, x, y, w, h:0.6, fill:{color}, line:{type:'none'}, color:(color===GOLD?NAVYDK:WHITE), bold:true, fontSize:11.5, align:'center', valign:'middle', fontFace:FONT });
  bullets(s, x+0.2, y+0.75, w-0.35, h-0.9, items, { fontSize:10.5 });
}
phaseCard(0.6,  'Phase 1 — Productionize & Integrate', NAVY, [
  'Real ITS IAM SSO (SAML2 / OIDC)',
  'Live IES read + write-back',
  'Scheduling / calendar sync',
  'Database persistence',
]);
phaseCard(3.69, 'Phase 2 — Scale & Record', BLUE, [
  'TURN server (cross-network)',
  'SFU for large hearings',
  'Server-side recording to NYS storage',
  'High-availability + load testing',
]);
phaseCard(6.78, 'Phase 3 — AI-Augment ✓ built', GOLD, [
  'Live captions / transcription ✓',
  'Translation assist for interpreters ✓',
  'Automated hearing summaries ✓',
  'Predictive wait-times ✓',
  'Next: accuracy + legal-record handling',
]);
phaseCard(9.87, 'Phase 4 — Expand & Optimize', GREEN, [
  'SMS / email notifications',
  'Native mobile apps',
  'Multilingual UI',
  'Analytics & docket optimization',
]);
box(s, 0.6, 6.05, 12.13, 0.75, 'Cross-cutting (every phase): security & compliance (WORM audit · encryption · retention · consent · pen-testing)  ·  WCAG 2.2 AA  ·  24/7 monitoring',
  { fill:NAVYDK, line:NAVYDK, color:WHITE, bold:true, fontSize:11.5 });

/* ============================================================ 12. CLOSE */
s = pptx.addSlide();
s.background = { color: NAVY };
s.addShape(S.rect, { x:0, y:2.4, w:W, h:0.07, fill:{color:GOLD}, line:{type:'none'} });
s.addText('Access to justice, by design.', { x:0.7, y:1.3, w:12, h:0.9, color:WHITE, fontSize:34, bold:true, fontFace:FONT });
s.addText('Faster, fairer, more transparent fair hearings for New Yorkers — and the oversight tools the staff who run them have never had.',
  { x:0.72, y:2.7, w:11.8, h:1.0, color:'CDDDE9', fontSize:17, fontFace:FONT });
bullets(s, 0.8, 3.9, 11.5, 2.4, [
  'A working system — on NYS standards — ready to integrate with IAM, IES & conferencing.',
  'In-house video means no vendor lock-in for virtual hearings.',
  'AI-built today; AI-augmented tomorrow (transcription, translation, summaries).',
], { fontSize:15, color:WHITE });
s.addText('The NYS Virtual Waiting Room   ·   Thank you', { x:0.72, y:6.4, w:12, h:0.5, color:GOLD, fontSize:18, bold:true, fontFace:FONT });

/* ---------- save ---------- */
pptx.writeFile({ fileName: 'VWR-Pitch-Deck.pptx' }).then(f => console.log('Created', f));
