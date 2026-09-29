// De kandidaten uit je luistergeschiedenis en het verzoek dat naar Claude gaat.
import type { Learned, Plan, PlanItem, PoolTrack, Rules, Signals, Track, VibeInfo } from './types.ts';
import { norm, normTitle, songKey } from './text.ts';
import { rejectReason, type EnforceContext } from './rules.ts';

export type HistoryInput = {
  topShort: Track[]; // laatste ~4 weken
  topMedium: Track[]; // laatste ~6 maanden
  topLong: Track[]; // ~jaar en langer
  recent: { track: Track; playedAt: number }[]; // laatste 50
  saved: Track[]; // opgeslagen nummers
};

/** Maakt één lijst: eerst je huidige favorieten ('nu'), dan oudere nummers om te herontdekken. */
export function buildPool(h: HistoryInput): PoolTrack[] {
  const plays = new Map<string, number>();
  for (const r of h.recent) plays.set(r.track.id, (plays.get(r.track.id) ?? 0) + 1);
  const out: PoolTrack[] = [];
  const seenId = new Set<string>();
  const seenSong = new Set<string>();
  const push = (t: Track, tier: 'nu' | 'ouder') => {
    const key = songKey(t.name, t.artists);
    if (seenId.has(t.id) || seenSong.has(key)) return;
    seenId.add(t.id);
    seenSong.add(key);
    out.push({ ...t, tier, plays: plays.get(t.id) ?? 0 });
  };
  const recentByCount = [...new Map(h.recent.map((r) => [r.track.id, r.track])).values()].sort(
    (a, b) => (plays.get(b.id) ?? 0) - (plays.get(a.id) ?? 0),
  );
  h.topShort.forEach((t) => push(t, 'nu'));
  recentByCount.forEach((t) => push(t, 'nu'));
  h.topMedium.slice(0, 20).forEach((t) => push(t, 'nu'));
  h.topMedium.slice(20).forEach((t) => push(t, 'ouder'));
  h.topLong.forEach((t) => push(t, 'ouder'));
  h.saved.forEach((t) => push(t, 'ouder'));
  return out;
}

export type ClaudeRef = { ref: string; track: PoolTrack };

/** Pool voor Claude: alleen wat mag, met korte verwijzingen (t1, t2 ...), zodat Claude geen id's hoeft te verzinnen. */
export function poolForClaude(pool: PoolTrack[], ctx: EnforceContext, max = { nu: 220, ouder: 160 }): ClaudeRef[] {
  const nu: PoolTrack[] = [];
  const ouder: PoolTrack[] = [];
  for (const t of pool) {
    if (rejectReason(t, ctx)) continue;
    if (t.tier === 'nu' && nu.length < max.nu) nu.push(t);
    else if (t.tier === 'ouder' && ouder.length < max.ouder) ouder.push(t);
  }
  return [...nu, ...ouder].map((track, i) => ({ ref: `t${i + 1}`, track }));
}

/** Wat de app aan de workflow geeft (wordt als JSON in de repo gezet). */
export type DjRequest = {
  id: string;
  createdAt: string;
  mode: 'nieuw' | 'bijsturen';
  vibe: string;
  adjust: string | null; // bij bijsturen: "rustiger", "meer NF" ...
  now: string; // "dinsdag 14:05"
  count: number;
  spares: number;
  newEvery: number;
  artistStart: string | null;
  worshipAllowed: boolean;
  eurovision: boolean;
  eurovisionFavorite: string;
  rules: string[];
  taste: string[];
  blockedArtists: string[];
  worshipArtists: string[];
  learned: {
    jumpTargets: string[];
    notInThisVibe: string[];
    suspectedDislike: string[];
    disliked: string[];
    resting: string[];
  };
  avoid: string[]; // speelt nu / staat al in de wachtrij
  previous: { ref: string; title: string; artist: string; style: string; isNew: boolean }[];
  pool: string; // regels "t1|Titel|Artiest|nu|3"
  model: string;
};

export function trackLabel(t: { name: string; artists: string[] } | { title: string; artist: string }): string {
  return 'name' in t ? `${t.name} – ${t.artists.join(', ')}` : `${t.title} – ${t.artist}`;
}

const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

export function nowLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildRequest(args: {
  id: string;
  vibe: VibeInfo;
  adjust?: string | null;
  previous?: Plan | null;
  refs: ClaudeRef[];
  rules: Rules;
  signals: Signals;
  learned: Learned;
  avoid: Track[];
  now: Date;
  model: string;
}): DjRequest {
  const { vibe, rules, signals, learned, refs } = args;
  const name = (id: string) => {
    const m = learned.meta[id];
    return m ? `${m.name} – ${m.artist}` : null;
  };
  const vibeKey = norm(vibe.text);
  const refById = new Map(refs.map((r) => [r.track.id, r.ref]));
  const top = Object.entries(signals.jumpTargets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id]) => name(id))
    .filter((x): x is string => !!x);
  const notInThisVibe = Object.entries(signals.notNow)
    .filter(([, list]) => list.some((s) => norm(s.vibe) === vibeKey))
    .map(([id]) => name(id))
    .filter((x): x is string => !!x);
  const resting = Object.entries(signals.resting)
    .filter(([, until]) => until > args.now.getTime())
    .map(([id]) => name(id))
    .filter((x): x is string => !!x);
  const previous = (args.previous?.items ?? []).map((it: PlanItem) => ({
    ref: refById.get(it.track.id) ?? '',
    title: it.track.name,
    artist: it.track.artists.join(', '),
    style: it.style,
    isNew: it.isNew,
  }));
  return {
    id: args.id,
    createdAt: args.now.toISOString(),
    mode: args.adjust ? 'bijsturen' : 'nieuw',
    vibe: vibe.text,
    adjust: args.adjust ?? null,
    now: nowLabel(args.now),
    count: rules.count,
    spares: 5,
    newEvery: rules.newEvery,
    artistStart: vibe.artistStart,
    worshipAllowed: vibe.worship,
    eurovision: vibe.eurovision,
    eurovisionFavorite: `${rules.eurovisionFavorite.title} – ${rules.eurovisionFavorite.artist}`,
    rules: rules.customRules,
    taste: rules.taste,
    blockedArtists: rules.blockedArtists,
    worshipArtists: rules.worshipArtists,
    learned: {
      jumpTargets: top,
      notInThisVibe,
      suspectedDislike: signals.suspicions.map((s) => `${s.name} – ${s.artist} (${s.reason})`),
      disliked: signals.disliked.map(name).filter((x): x is string => !!x),
      resting,
    },
    avoid: args.avoid.map(trackLabel),
    previous,
    pool: refs
      .map((r) => {
        const t = r.track;
        const clean = (s: string) => s.replace(/[|\n]/g, ' ');
        return `${r.ref}|${clean(t.name)}|${clean(t.artists.join(', '))}|${t.tier}${t.plays ? `|${t.plays}x recent` : ''}`;
      })
      .join('\n'),
    model: args.model,
  };
}

// ---------- antwoord van Claude ----------

export type ClaudeItem = { ref: string; title: string; artist: string; style: string; new: boolean; energy: number };
export type ClaudeAnswer = { title: string; note: string; items: ClaudeItem[]; spares: ClaudeItem[] };

export type DjResponse = {
  id: string;
  status: 'ok' | 'limiet' | 'token' | 'fout';
  message: string;
  resetAt: string | null; // tekst of ISO, zoals Claude Code het meldt
  answer: ClaudeAnswer | null;
  finishedAt: string;
  costUsd?: number | null;
  durationMs?: number | null;
};

function asItem(x: unknown): ClaudeItem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const artist = typeof o.artist === 'string' ? o.artist.trim() : '';
  const ref = typeof o.ref === 'string' ? o.ref.trim() : '';
  if (!ref && (!title || !artist)) return null;
  const energy = Number(o.energy);
  return {
    ref,
    title,
    artist,
    style: typeof o.style === 'string' && o.style.trim() ? o.style.trim() : 'Overig',
    new: o.new === true,
    energy: Number.isFinite(energy) ? Math.min(5, Math.max(1, Math.round(energy))) : 3,
  };
}

/** Maakt een antwoord robuust: onbekende velden weg, lege items eruit. */
export function parseAnswer(raw: unknown): ClaudeAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map(asItem).filter((x): x is ClaudeItem => !!x) : [];
  if (!items.length) return null;
  const spares = Array.isArray(o.spares) ? o.spares.map(asItem).filter((x): x is ClaudeItem => !!x) : [];
  return {
    title: typeof o.title === 'string' ? o.title : '',
    note: typeof o.note === 'string' ? o.note : '',
    items,
    spares,
  };
}

/**
 * Kiest uit zoekresultaten het nummer dat Claude bedoelde: zelfde artiest én (bijna) dezelfde titel,
 * anders dezelfde artiest met een titel die erop lijkt. Geen artiest-match = niet gevonden.
 */
export function bestMatch(candidates: Track[], title: string, artist: string): Track | null {
  const t = normTitle(title);
  const a = norm(artist);
  const artistOk = (c: Track) => c.artists.some((x) => {
    const n = norm(x);
    return n === a || (n.length > 3 && a.includes(n)) || (a.length > 3 && n.includes(a));
  });
  const exact = candidates.find((c) => artistOk(c) && normTitle(c.name) === t);
  if (exact) return exact;
  const close = candidates.find((c) => {
    if (!artistOk(c)) return false;
    const ct = normTitle(c.name);
    return ct.startsWith(t) || t.startsWith(ct) || ct.includes(t);
  });
  return close ?? null;
}
