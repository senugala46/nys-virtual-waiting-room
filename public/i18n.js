/* Internationalization for the VWR — NYS language-access set (12 languages + English).
 *
 * English + Spanish are baked in (offline, verified). The other 11 languages are
 * populated on demand via the AI translation service (/api/ai/translate-ui),
 * cached in localStorage. When no translation service is configured, non-baked
 * languages gracefully fall back to English rather than showing low-quality text.
 *
 * Usage: VWRi18n.t('key', {vars}). Static HTML uses [data-i18n], [data-i18n-ph],
 * [data-i18n-title]. Call VWRi18n.setLang(code) to switch.
 */
(function () {
  'use strict';

  // NYS statewide language-access languages (Executive Order 26.1) + English.
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
      'common.language': 'Language',
      'common.empty': 'No hearings match your view.',
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
      'mt.notice': 'Machine-translated for accessibility.',
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
      'common.language': 'Idioma',
      'common.empty': 'Ninguna audiencia coincide con su vista.',
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
      'mt.notice': 'Traducción automática para accesibilidad.',
    },
  };

  let lang = localStorage.getItem('vwrLang') || 'en';
  let aiEnabled = false;
  let dyn = {};
  try { dyn = JSON.parse(localStorage.getItem('vwrI18nCache') || '{}'); } catch (_) { dyn = {}; }

  function dictFor(l) {
    if (l === 'en') return STRINGS.en;
    return Object.assign({}, STRINGS.en, STRINGS[l] || {}, dyn[l] || {});
  }

  function t(key, vars) {
    const d = dictFor(lang);
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

  // Fetch AI translations for all keys of a non-baked language and cache them.
  async function ensureLang(l) {
    if (l === 'en' || STRINGS[l] || dyn[l]) return;     // baked or already cached
    if (!aiEnabled) return;                              // will fall back to English
    const keys = Object.keys(STRINGS.en);
    const texts = keys.map((k) => STRINGS.en[k]);
    try {
      const res = await fetch('/api/ai/translate-ui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, to: l }),
      });
      const data = await res.json();
      if (data && Array.isArray(data.translations) && data.translations.length === keys.length) {
        const map = {};
        keys.forEach((k, i) => (map[k] = data.translations[i]));
        dyn[l] = map;
        localStorage.setItem('vwrI18nCache', JSON.stringify(dyn));
      }
    } catch (_) { /* keep English fallback */ }
  }

  async function setLang(l) {
    lang = l;
    localStorage.setItem('vwrLang', l);
    await ensureLang(l);
    setDir();
    applyStatic();
    if (typeof window.VWRonLangChange === 'function') window.VWRonLangChange();
  }

  function isMachineTranslated(l) {
    const code = l || lang;
    return code !== 'en' && !STRINGS[code]; // not baked -> AI/fallback
  }

  window.VWRi18n = {
    t, setLang, getLang: () => lang, LANGS,
    applyStatic, ensureLang, isMachineTranslated,
    init: (opts) => { aiEnabled = !!(opts && opts.aiEnabled); },
  };

  // Apply baked language immediately on load (before app boot).
  setDir();
  document.addEventListener('DOMContentLoaded', () => applyStatic());
})();
