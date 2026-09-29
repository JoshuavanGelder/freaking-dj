// Spraak: de herkenner kent jouw woorden niet ("legday" → "lekdij"). We geven hem hints mee
// (je eigen vibes en artiesten) en verbeteren achteraf wat klinkt als een van die woorden.
import { norm } from './text.ts';

export type HintSource = {
  quickVibes: string[];
  vibes: string[]; // laatst gebruikte vibes
  planVibes: string[]; // vibes van recente wachtrijen
  artists: string[]; // artiesten uit je geschiedenis, belangrijkste eerst
};

const MAX_HINTS = 100;
const MAX_ARTISTS = 40;
const MIN_KEY = 4; // kortere woorden niet op klank verbeteren, te veel kans op fout

/** Woorden en zinnen die de herkenner moet kennen: jouw vibes eerst, dan artiesten. Uniek, max 100. */
export function speechHints(src: HintSource): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    const k = norm(t);
    if (!t || !k || seen.has(k) || out.length >= MAX_HINTS) return;
    seen.add(k);
    out.push(t);
  };
  src.quickVibes.forEach(add);
  src.vibes.forEach(add);
  src.planVibes.forEach(add);
  src.artists.slice(0, MAX_ARTISTS).forEach(add);
  return out;
}

/**
 * Klanksleutel: schrijfwijzen die hetzelfde klinken krijgen dezelfde sleutel, ook Engels uitgesproken
 * door een Nederlander. "legday" en "lekdij" → "lektY"; "Avicii" en "a vichi" → "afiki".
 */
export function soundKey(s: string): string {
  return norm(s)
    .replace(/ /g, '')
    .replace(/sch/g, 'sk')
    .replace(/ch/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/(igh|ij|ei|ey|ay|ai)/g, 'Y')
    .replace(/(ou|au|ow)/g, 'W')
    .replace(/(ie|ee|ea)/g, 'I')
    .replace(/(oe|oo)/g, 'U')
    .replace(/y/g, 'I')
    .replace(/[gkcq]/g, 'k')
    .replace(/d/g, 't')
    .replace(/v/g, 'f')
    .replace(/z/g, 's')
    .replace(/w/g, 'W')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}

/**
 * Kiest en verbetert de tekst uit de alternatieven van de herkenner (beste eerst):
 * 1. een alternatief dat precies een hint is;
 * 2. een alternatief dat als geheel klinkt als een hint;
 * 3. anders het beste alternatief, met losse woorden (1–3 achter elkaar) vervangen door een hint die net zo klinkt.
 */
export function fixTranscript(alternatives: string[], hints: string[]): string {
  const alts = alternatives.map((a) => a.trim()).filter(Boolean);
  if (!alts.length) return '';
  const byNorm = new Map(hints.map((h) => [norm(h), h] as const));
  for (const a of alts) {
    const h = byNorm.get(norm(a));
    if (h) return h;
  }

  const byKey = new Map<string, string>();
  for (const h of hints) {
    const k = soundKey(h);
    if (k.length >= MIN_KEY && !byKey.has(k)) byKey.set(k, h);
  }
  for (const a of alts) {
    const h = byKey.get(soundKey(a));
    if (h) return h;
  }

  // Alleen hints van 1–3 woorden losse stukjes laten vervangen.
  const short = new Map<string, string>();
  for (const [k, h] of byKey) if (h.trim().split(/\s+/).length <= 3) short.set(k, h);

  const words = alts[0].split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let hit: { n: number; hint: string } | null = null;
    for (let n = Math.min(3, words.length - i); n >= 1 && !hit; n--) {
      const piece = words.slice(i, i + n).join(' ');
      const h = short.get(soundKey(piece));
      if (h) hit = { n, hint: h };
    }
    if (hit) {
      out.push(hit.hint);
      i += hit.n;
    } else {
      out.push(words[i]);
      i += 1;
    }
  }
  return out.join(' ');
}
