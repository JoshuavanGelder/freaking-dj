// Pure hulpfuncties voor de DJ-workflow (getest met node --test dj/lib.test.mjs).

export const MODELS = ['sonnet', 'opus', 'haiku'];

/** Alleen veilige ids: letters, cijfers en streepjes. */
export function validId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{4,48}$/i.test(id);
}

/** Maakt van het verzoek (JSON) een leesbaar bericht voor Claude. */
export function renderRequest(r) {
  const list = (title, items) => (items && items.length ? `### ${title}\n${items.map((x) => `- ${x}`).join('\n')}\n` : '');
  const lines = [];
  lines.push(`# Request (${r.mode === 'bijsturen' ? 'bijsturen' : 'new queue'})`);
  lines.push(`- vibe: ${r.vibe}`);
  if (r.adjust) lines.push(`- adjustment: ${r.adjust}`);
  lines.push(`- now: ${r.now}`);
  lines.push(`- count: ${r.count}`);
  lines.push(`- spares: ${r.spares}`);
  lines.push(`- newEvery: 1 new track per ${Math.max(2, r.newEvery - 1)}–${r.newEvery} known tracks`);
  lines.push(`- artistStart: ${r.artistStart ?? 'none'}`);
  lines.push(`- worshipAllowed: ${r.worshipAllowed ? 'true' : 'false'}`);
  lines.push(`- eurovision: ${r.eurovision ? 'true' : 'false'}`);
  lines.push(`- Eurovision favourite (always in a Eurovision queue): ${r.eurovisionFavorite}`);
  lines.push('');
  lines.push(list("Joshua's rules (Dutch)", r.rules));
  lines.push(list('Taste notes (starting point, Dutch)', r.taste));
  lines.push(list('Blocked artists (never)', r.blockedArtists));
  lines.push(list('Worship artists (only when worshipAllowed)', r.worshipArtists));
  const l = r.learned ?? {};
  lines.push(list('Learned: jumpTargets (skipped towards these: strong favourites)', l.jumpTargets));
  lines.push(list('Learned: notInThisVibe (skipped in this vibe, avoid now)', l.notInThisVibe));
  lines.push(list('Learned: suspectedDislike (avoid)', l.suspectedDislike));
  lines.push(list('Learned: disliked (never)', l.disliked));
  lines.push(list('Learned: resting (played too often lately, already left out of the pool)', l.resting));
  lines.push(list('Avoid (playing now or already queued)', r.avoid));
  if (r.previous && r.previous.length) {
    lines.push('### Previous queue (play order)');
    r.previous.forEach((p, i) => lines.push(`${i + 1}. ${p.ref ? `[${p.ref}] ` : ''}${p.title} – ${p.artist} (${p.style}${p.isNew ? ', new' : ''})`));
    lines.push('');
  }
  lines.push('### Pool (ref|title|artists|tier|plays)');
  lines.push(r.pool || '(empty)');
  return lines.filter((x) => x !== '').join('\n');
}

const LIMIT_RE = /usage limit|limit reached|hit your (?:usage )?limit|you've reached your|rate[_ ]limit|out of (?:extra )?usage|weekly limit|session limit/i;
const AUTH_RE = /invalid (?:api key|bearer token|oauth token)|oauth token (?:has )?expired|authentication[_ ]error|please run \/login|not logged in|could not resolve authentication|401\b|token (?:is )?(?:invalid|expired|revoked)/i;

/** Maakt van de melding van Claude Code een leesbare resettijd, als die erin staat. */
export function parseReset(text, timeZone = 'Europe/Amsterdam') {
  if (!text) return null;
  const epoch = text.match(/\|(\d{10,13})\b/);
  if (epoch) {
    const n = Number(epoch[1]);
    const d = new Date(epoch[1].length === 13 ? n : n * 1000);
    return d.toLocaleString('nl-NL', { timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit' });
  }
  const resets = text.match(/resets?\s+(?:at\s+|on\s+)?([^\n·.|]{2,40})/i);
  if (resets) return resets[1].trim();
  const again = text.match(/try again (?:at|after|in)\s+([^\n.]{2,40})/i);
  if (again) return again[1].trim();
  return null;
}

/**
 * Bepaalt de uitkomst van een run.
 * out = geparste JSON-uitvoer van `claude -p --output-format json` (of null),
 * raw = ruwe stdout+stderr, code = exitcode.
 */
export function classify(out, raw, code) {
  const text = [out && typeof out.result === 'string' ? out.result : '', raw || ''].join('\n');
  const failed = code !== 0 || !out || out.is_error === true || (out.subtype && out.subtype !== 'success');
  if (!failed && out && out.structured_output) {
    return { status: 'ok', message: 'Klaar', resetAt: null, answer: out.structured_output };
  }
  if (!failed && out && typeof out.result === 'string') {
    // Geen structured_output: probeer JSON uit de tekst te halen.
    const answer = extractJson(out.result);
    if (answer) return { status: 'ok', message: 'Klaar', resetAt: null, answer };
  }
  if (LIMIT_RE.test(text)) {
    return { status: 'limiet', message: 'Je Claude-limiet is op.', resetAt: parseReset(text), answer: null };
  }
  if (AUTH_RE.test(text)) {
    return {
      status: 'token',
      message: 'Het Claude-token werkt niet (verlopen of ongeldig). Maak een nieuw token met "claude setup-token" en zet het als secret CLAUDE_CODE_OAUTH_TOKEN.',
      resetAt: null,
      answer: null,
    };
  }
  const short = (out && typeof out.result === 'string' && out.result) || (raw || '').trim().split('\n').slice(-3).join(' ');
  return { status: 'fout', message: `Claude gaf geen bruikbaar antwoord: ${String(short).slice(0, 300)}`, resetAt: null, answer: null };
}

/** Haalt het eerste JSON-object uit een tekst (fallback als er geen structured_output is). */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    return obj && Array.isArray(obj.items) ? obj : null;
  } catch {
    return null;
  }
}

/** Laatste regel van stdout die geldige JSON is (claude -p --output-format json schrijft één object). */
export function parseCliOutput(stdout) {
  const t = (stdout || '').trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    const lines = t.split('\n').reverse();
    for (const l of lines) {
      try {
        const o = JSON.parse(l);
        if (o && typeof o === 'object') return o;
      } catch {
        /* volgende */
      }
    }
    return null;
  }
}
