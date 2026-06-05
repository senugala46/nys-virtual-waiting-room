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

module.exports = { translate, summarize, LANGS, HAS_AI };
