// Wensen die je zelf intypt: "meer Alex Warren". Claude krijgt ze mee, maar de app zorgt er zelf voor dat ze er
// echt in komen: ongeveer elk tweede nummer is van die artiest, ook in de gym, en wat Claude niet levert zoekt de
// app op Spotify. In Live DJ geldt de wens voor de rest van de sessie (ook bij automatisch bijsturen), tot je
// "meer <iemand anders>" vraagt of "minder/geen/genoeg <artiest>" zegt.
import type { PlanItem, PoolTrack, Track, TrackMeta } from './types.ts';
import { artistIn, norm, songKey } from './text.ts';

/** Woorden vóór de artiest die "meer" betekenen. */
const MORE_BEFORE = new Set(['meer', 'vooral', 'alleen', 'extra', 'more', 'only', 'lekker']);
/** Woorden vóór de artiest die "minder/geen" betekenen. */
const LESS_BEFORE = new Set(['minder', 'geen', 'genoeg', 'zonder', 'less', 'no', 'stop', 'klaar']);
/** Woorden ná de artiest die "meer" betekenen ("Alex Warren luisteren", "Alex Warren graag"). */
const MORE_AFTER = new Set(['luisteren', 'horen', 'draaien', 'spelen', 'graag', 'aub', 'please']);
const NEG = new Set(['geen', 'niet', 'no', 'not']);
const FILLER = new Set(['nummers', 'liedjes', 'songs', 'tracks', 'muziek']);

/** Alle artiesten die de app van je kent (geschiedenis, geleerde nummers en wat er nu in de sessie zit). */
export function knownArtists(pool: PoolTrack[], meta: Record<string, TrackMeta>, extra: Track[] = []): string[] {
  const seen = new Map<string, string>();
  const add = (a: string) => {
    const k = norm(a);
    if (k.replace(/ /g, '').length >= 2 && !seen.has(k)) seen.set(k, a.trim());
  };
  for (const t of pool) t.artists.forEach(add);
  for (const m of Object.values(meta)) m.artist.split(/,\s*/).forEach(add);
  for (const t of extra) t.artists.forEach(add);
  return [...seen.values()];
}

/**
 * Welke bekende artiesten wil je meer of minder? Alleen namen die de app van je kent, zodat "meer pop/pop rock"
 * of "meer energie" geen artiest wordt (dat laat de app aan Claude).
 */
export function wishArtists(text: string, known: string[]): { more: string[]; less: string[] } {
  const more: string[] = [];
  const less: string[] = [];
  const arts = known
    .map((name) => ({ name, words: norm(name).split(' ').filter(Boolean) }))
    .filter((a) => a.words.length && a.words.join('').length >= 2)
    .sort((a, b) => b.words.length - a.words.length); // langste eerst: "Macklemore & Ryan Lewis" vóór "Macklemore"
  for (const clause of text.split(/[.!?;\n]+/)) {
    const w = norm(clause).split(' ').filter(Boolean);
    const taken = new Array<boolean>(w.length).fill(false);
    for (const a of arts) {
      for (let i = 0; i + a.words.length <= w.length; i++) {
        if (a.words.some((x, j) => taken[i + j] || w[i + j] !== x)) continue;
        for (let j = 0; j < a.words.length; j++) taken[i + j] = true;
        const end = i + a.words.length;
        let kind: 'more' | 'less' | null = null;
        // Het dichtstbijzijnde signaalwoord ervoor beslist ("meer NF, minder AC/DC en Bon Jovi").
        for (let k = i - 1; k >= 0 && !kind; k--) {
          if (MORE_BEFORE.has(w[k])) {
            // "niet meer NF", "geen nummers meer van NF" = minder.
            const neg = NEG.has(w[k - 1]) || (FILLER.has(w[k - 1]) && NEG.has(w[k - 2]));
            kind = neg ? 'less' : 'more';
          } else if (LESS_BEFORE.has(w[k]) || NEG.has(w[k])) kind = 'less';
        }
        // Niets ervoor: "Alex Warren luisteren", of alleen de naam.
        if (!kind && (w.slice(end).some((x) => MORE_AFTER.has(x)) || (i === 0 && end === w.length))) kind = 'more';
        const list = kind === 'more' ? more : kind === 'less' ? less : null;
        if (list && !list.some((x) => norm(x) === norm(a.name))) list.push(a.name);
      }
    }
  }
  return { more, less: less.filter((l) => !more.some((m) => norm(m) === norm(l))) };
}

/** De wens voor de rest van de sessie: nieuwe "meer X" vervangt de oude, "minder/geen X" haalt X eruit. */
export function updateWishes(current: string[], text: string, known: string[]): string[] {
  const { more, less } = wishArtists(text, known);
  const next = more.length ? more : current;
  return next.filter((a) => !less.some((l) => norm(l) === norm(a)));
}

/** Is dit nummer van een gevraagde artiest? */
export function isWanted(track: { artists: string[] }, wanted: string[] | undefined): boolean {
  return !!wanted?.length && artistIn(track.artists, wanted);
}

const VARIANT_RE = /\b(sped up|slowed|acoustic|akoestisch|instrumental|karaoke|live|remix|reverb|nightcore|piano version|8d)\b/i;

/** Zoekresultaten van Spotify: alleen echte nummers van de gevraagde artiest, geen sped-up/akoestisch/live-versies, geen dubbelen. */
export function artistTracks(found: Track[], wanted: string[]): Track[] {
  const seen = new Set<string>();
  return found.filter((t) => {
    if (!isWanted(t, wanted) || VARIANT_RE.test(t.name)) return false;
    const k = songKey(t.name, t.artists);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Zet nummers van de gevraagde artiesten op elke `every`-de plek, te beginnen bovenaan (bij meerdere artiesten om
 * en om). Bronnen: wat al in de lijst stond, de reserves en `extra` (bv. van Spotify gezocht). De lengte blijft gelijk;
 * wat overblijft gaat naar de reserves, gevraagde nummers eerst (in Live DJ komen die dus daarna nog).
 */
export function boostWanted(items: PlanItem[], spares: PlanItem[], extra: PlanItem[], wanted: string[], every = 2): { items: PlanItem[]; spares: PlanItem[] } {
  if (!wanted.length) return { items, spares };
  const isW = (it: PlanItem) => isWanted(it.track, wanted);
  const seen = new Set<string>();
  const fresh = (it: PlanItem) => {
    const k = songKey(it.track.name, it.track.artists);
    if (seen.has(k) || seen.has(it.track.id)) return false;
    seen.add(k);
    seen.add(it.track.id);
    return true;
  };
  const all = [...items, ...spares, ...extra].filter(fresh);
  const others = items.filter((it) => !isW(it) && all.includes(it));
  // Per gevraagde artiest een rij, dan om en om, zodat dezelfde artiest niet steeds terugkomt als je er twee vroeg.
  const queues = wanted.map((a) => all.filter((it) => isW(it) && artistIn(it.track.artists, [a])));
  const used = new Set<PlanItem>();
  const ws: PlanItem[] = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const it = q[round];
      if (it && !used.has(it)) {
        used.add(it);
        ws.push(it);
      }
    }
  }
  const out: PlanItem[] = [];
  let o = 0;
  let w = 0;
  for (let pos = 0; out.length < items.length && (o < others.length || w < ws.length); pos++) {
    if (pos % every === 0 && w < ws.length) out.push(ws[w++]);
    else if (o < others.length) out.push(others[o++]);
    else out.push(ws[w++]);
  }
  const placed = new Set(out);
  const rest = [...ws.slice(w), ...others.slice(o), ...spares.filter((it) => !isW(it) && all.includes(it) && !placed.has(it))];
  return { items: out, spares: rest };
}
