// De harde regels. Claude stelt voor, maar de app controleert altijd zelf:
// blocklist, niet-leuk, rust, worship alleen op verzoek, geen dubbelen, niet twee keer
// dezelfde artiest achter elkaar, "begin met X" en je Eurovisie-favoriet.
import type { PlanItem, PoolTrack, Removed, Rules, Signals, Track, VibeInfo } from './types.ts';
import { artistIn, norm, shareArtist, songKey } from './text.ts';

export const DEFAULT_RULES: Rules = {
  blockedArtists: ['Loreen'],
  worshipArtists: [
    'Josiah Queen',
    'Hillsong',
    'Elevation Worship',
    'Lauren Daigle',
    'Casting Crowns',
    'Brandon Lake',
    'Rend Collective',
    'Bijbel Beukers',
  ],
  eurovisionFavorite: { title: 'Viva, Moldova!', artist: 'Satoshi' },
  customRules: [
    'Vooral nummers die ik ken uit mijn luistergeschiedenis: vooral mijn huidige favorieten plus een paar oudere om te herontdekken.',
    'Per 3 à 4 bekende nummers ongeveer 1 populair nieuw nummer uit hetzelfde genre of dezelfde vibe.',
    'De energie wisselt af, niet twee keer dezelfde artiest achter elkaar, geen dubbelen.',
    'Een genre-vibe betekent nummers uit dat genre. Bij Eurovisie alleen echte Eurovisie-inzendingen (het inzendingsnummer zelf). Een artiest die ooit meedeed of presenteerde telt niet met zijn andere nummers.',
    'Worship/christelijke muziek luister ik veel, maar alleen als ik erom vraag.',
    'Mijn favoriete Eurovisie 2026-nummer is "Viva, Moldova!" (Satoshi, Moldavië). Dat zit altijd in een Eurovisie-wachtrij.',
  ],
  taste: [
    'Coding/energie: Morgan Wallen, NF, Fall Out Boy, Avicii, Alan Walker, Egzod, LUM!X / Gabry Ponte, Imagine Dragons, Alex Warren, Flo Rida, Black Eyed Peas, AC/DC, Green Day, Sean Paul, YUNGBLUD, OneRepublic, Panic! At The Disco.',
    'Eurovisie: Viva, Moldova!, Liekinheitin, Per sempre sì, Arcade, Heroes, Rim Tim Tagi Dim, Fuego, SHUM, Zitti e buoni, Voilà, Ferto, My System.',
    'Frans/overig: Indila, Barbara Pravi, Shakira, KPop Demon Hunters (Golden, How It\'s Done).',
    'Ordinary (Alex Warren) draai ik vaak op repeat.',
  ],
  quickVibes: ['Coding', 'Gym', 'Eurovisie', 'Rustig', 'Frans', 'Worship'],
  count: 25,
  newEvery: 4,
  pcDevice: 'joshua-mooore',
  neverDevices: ['Denon'],
};

// ---------- vibe begrijpen ----------

const WORSHIP_RE = /worship|christelijk|aanbidding|lofprijs|opwekking|gospel|\bkerk/i;
const EUROVISION_RE = /eurovisi|songfestival|\besc\b|eurosong/i;
const ARTIST_START_RE = /\b(?:begin|start|open|beginnen)\s+(?:met|with)\s+(.+?)(?:\s*[,.;!]|\s+en\s+(?:daarna|dan|verder)\b|$)/i;

/** Losse match voor worship-artiesten: "Hillsong" past ook op "Hillsong UNITED". */
export function isWorshipArtist(artists: string[], list: string[]): boolean {
  const keys = list.map(norm).filter(Boolean);
  return artists.some((a) => {
    const n = norm(a);
    return keys.some((k) => n === k || n.startsWith(k + ' '));
  });
}

export function parseVibe(text: string, rules: Rules): VibeInfo {
  const t = text.trim();
  const m = t.match(ARTIST_START_RE);
  const artistStart = m ? m[1].trim().replace(/^(de|het)\s+/i, '') : null;
  const n = norm(t);
  const mentionsWorshipArtist = rules.worshipArtists.some((w) => {
    const k = norm(w);
    return k.length > 2 && n.includes(k);
  });
  return {
    text: t,
    artistStart: artistStart || null,
    worship: WORSHIP_RE.test(t) || mentionsWorshipArtist,
    eurovision: EUROVISION_RE.test(t),
  };
}

// ---------- controleren ----------

export type EnforceContext = {
  rules: Rules;
  vibe: VibeInfo;
  signals: Signals;
  now: number;
  /** Staat al in de wachtrij of speelt nu (bij toevoegen): niet nog eens. */
  alreadyQueued?: Set<string>;
  /** Je Eurovisie-favoriet, al opgezocht op Spotify. */
  favorite?: Track | null;
  /** Titel+artiest van bevestigd niet-leuke nummers (vangt andere versies af). */
  dislikedKeys?: Set<string>;
};

const NOT_NOW_DAYS = 7;

/** Waarom mag dit nummer er niet in? null = mag wel. */
export function rejectReason(track: Track, ctx: EnforceContext): string | null {
  const { rules, signals, vibe, now } = ctx;
  const fav = isFavorite(track, rules);
  if (artistIn(track.artists, rules.blockedArtists)) return 'blocklist';
  if (signals.disliked.includes(track.id) || ctx.dislikedKeys?.has(songKey(track.name, track.artists))) {
    return 'niet leuk (bevestigd)';
  }
  if (!vibe.worship && isWorshipArtist(track.artists, rules.worshipArtists)) return 'worship alleen op verzoek';
  if (ctx.alreadyQueued?.has(track.id)) return 'staat al in je wachtrij';
  if (!fav) {
    const rest = signals.resting[track.id];
    if (rest && rest > now) return 'rust (te vaak gedraaid)';
    const skips = signals.notNow[track.id] ?? [];
    const v = norm(vibe.text);
    if (skips.some((s) => norm(s.vibe) === v && now - s.at < NOT_NOW_DAYS * 86400000)) return 'geen zin in bij deze vibe';
  }
  return null;
}

export function isFavorite(track: Track, rules: Rules): boolean {
  const f = rules.eurovisionFavorite;
  return songKey(track.name, track.artists) === songKey(f.title, [f.artist]);
}

export type Enforced = { items: PlanItem[]; spares: PlanItem[]; removed: Removed[] };

/**
 * Past alle harde regels toe op Claudes voorstel.
 * Volgorde: weghalen wat niet mag, dubbelen eruit, favoriet erin, artiest vooraan,
 * dan zorgen dat niet twee keer dezelfde artiest achter elkaar komt.
 */
export function enforce(proposed: PlanItem[], proposedSpares: PlanItem[], ctx: EnforceContext): Enforced {
  const removed: Removed[] = [];
  const seenId = new Set<string>();
  const seenSong = new Set<string>();
  const keep = (list: PlanItem[], log: boolean): PlanItem[] => {
    const out: PlanItem[] = [];
    for (const it of list) {
      const reason = rejectReason(it.track, ctx);
      const key = songKey(it.track.name, it.track.artists);
      const dup = seenId.has(it.track.id) || seenSong.has(key);
      const why = reason ?? (dup ? 'dubbel' : null);
      if (why) {
        if (log) removed.push({ title: it.track.name, artist: it.track.artists.join(', '), reason: why });
        continue;
      }
      seenId.add(it.track.id);
      seenSong.add(key);
      out.push(it);
    }
    return out;
  };
  let items = keep(proposed, true);
  let spares = keep(proposedSpares, false);

  // Eurovisie: je favoriet zit er altijd in.
  if (ctx.vibe.eurovision && ctx.favorite && !items.some((it) => isFavorite(it.track, ctx.rules))) {
    const favItem: PlanItem = { track: ctx.favorite, style: items[0]?.style ?? 'Eurovisie', isNew: false, energy: 4 };
    if (!(ctx.alreadyQueued?.has(ctx.favorite.id))) items.splice(Math.min(2, items.length), 0, favItem);
  }

  // Te veel? De rest wordt reserve.
  let protect = 0;
  if (ctx.vibe.artistStart) {
    const r = artistFirst(items, ctx.vibe.artistStart);
    items = r.items;
    protect = r.block;
  }
  if (items.length > ctx.rules.count) {
    const extra = items.slice(ctx.rules.count);
    items = items.slice(0, ctx.rules.count);
    spares = [...extra, ...spares];
  }
  // Na het inkorten kan de favoriet eraf gevallen zijn: terugzetten op plek 3.
  if (ctx.vibe.eurovision && ctx.favorite && !items.some((it) => isFavorite(it.track, ctx.rules))) {
    const i = spares.findIndex((it) => isFavorite(it.track, ctx.rules));
    if (i >= 0) {
      const [fav] = spares.splice(i, 1);
      const out = items.pop();
      if (out) spares.unshift(out);
      items.splice(Math.min(Math.max(2, protect), items.length), 0, fav);
    }
  }
  items = spreadArtists(items, protect);
  return { items, spares, removed };
}

function byArtist(it: PlanItem, artist: string): boolean {
  const a = norm(artist);
  return it.track.artists.some((x) => {
    const n = norm(x);
    return n === a || n.includes(a) || a.includes(n);
  });
}

/** "Begin met X": eerst een blokje van (max) 3 nummers van X, de rest van X verspreid verderop. */
export function artistFirst(items: PlanItem[], artist: string): { items: PlanItem[]; block: number } {
  const mine = items.filter((it) => byArtist(it, artist));
  if (!mine.length) return { items, block: 0 };
  const others = items.filter((it) => !byArtist(it, artist));
  const block = mine.slice(0, 3);
  const rest = mine.slice(3);
  const out = [...others];
  // Verdeel de rest gelijkmatig; begin pas na een paar andere nummers.
  rest.forEach((it, k) => {
    const pos = Math.round(((k + 1) * others.length) / (rest.length + 1)) + k;
    out.splice(Math.min(Math.max(pos, 2 + k), out.length), 0, it);
  });
  return { items: [...block, ...out], block: block.length };
}

/**
 * Zorgt dat niet twee keer dezelfde artiest achter elkaar komt.
 * De eerste `protect` nummers (het artiestenblokje) blijven staan.
 */
export function spreadArtists(input: PlanItem[], protect = 0): PlanItem[] {
  const a = [...input];
  const start = Math.max(1, protect);
  const clash = (x: PlanItem | undefined, y: PlanItem | undefined) => !!x && !!y && shareArtist(x.track.artists, y.track.artists);
  const clashAt = (p: number) => p >= start && p < a.length && clash(a[p], a[p - 1]);
  const trySwap = (i: number, j: number): boolean => {
    [a[i], a[j]] = [a[j], a[i]];
    const bad = [i, i + 1, j, j + 1].some(clashAt);
    if (bad) [a[i], a[j]] = [a[j], a[i]];
    return !bad;
  };
  for (let i = start; i < a.length; i++) {
    if (!clashAt(i)) continue;
    let fixed = false;
    // Eerst verderop zoeken, dan (na het blokje) terug.
    for (let j = i + 1; j < a.length && !fixed; j++) fixed = trySwap(i, j);
    for (let j = start; j < i && !fixed; j++) fixed = trySwap(i, j);
  }
  return a;
}

/** Artiesten die direct na elkaar komen (voor tests en een waarschuwing in de app). */
export function consecutiveClashes(items: PlanItem[], protect = 0): number {
  let n = 0;
  for (let i = Math.max(1, protect); i < items.length; i++) {
    if (shareArtist(items[i].track.artists, items[i - 1].track.artists)) n++;
  }
  return n;
}

// ---------- tonen ----------

export type StyleGroup = { style: string; entries: { item: PlanItem; index: number }[] };

/** Groepeert per stijl, in de volgorde waarin de stijl voor het eerst voorkomt. */
export function groupByStyle(items: PlanItem[]): StyleGroup[] {
  const groups: StyleGroup[] = [];
  const at = new Map<string, StyleGroup>();
  items.forEach((item, index) => {
    const key = norm(item.style) || 'overig';
    let g = at.get(key);
    if (!g) {
      g = { style: item.style || 'Overig', entries: [] };
      at.set(key, g);
      groups.push(g);
    }
    g.entries.push({ item, index });
  });
  return groups;
}

export function totalMinutes(items: PlanItem[]): number {
  return Math.round(items.reduce((s, it) => s + (it.track.durationMs || 0), 0) / 60000);
}

// ---------- één nummer wisselen ----------

/**
 * Zoekt een vervanger voor het nummer op `index`: eerst uit de reserves (liefst dezelfde stijl),
 * dan uit je geschiedenis. Past op de regels en op de buren (geen zelfde artiest ernaast).
 */
export function pickReplacement(
  items: PlanItem[],
  spares: PlanItem[],
  index: number,
  pool: PoolTrack[],
  ctx: EnforceContext,
): { item: PlanItem; spares: PlanItem[] } | null {
  const current = items[index];
  if (!current) return null;
  const inPlan = new Set(items.map((it) => it.track.id));
  const inPlanSong = new Set(items.map((it) => songKey(it.track.name, it.track.artists)));
  const prev = items[index - 1];
  const next = items[index + 1];
  const fits = (t: Track) =>
    !inPlan.has(t.id) &&
    !inPlanSong.has(songKey(t.name, t.artists)) &&
    !rejectReason(t, ctx) &&
    !(prev && shareArtist(prev.track.artists, t.artists)) &&
    !(next && shareArtist(next.track.artists, t.artists)) &&
    !shareArtist(current.track.artists, t.artists);

  const sameStyle = spares.findIndex((s) => norm(s.style) === norm(current.style) && fits(s.track));
  const anySpare = sameStyle >= 0 ? sameStyle : spares.findIndex((s) => fits(s.track));
  if (anySpare >= 0) {
    const rest = spares.filter((_, i) => i !== anySpare);
    return { item: spares[anySpare], spares: [...rest, current] };
  }
  // Uit je geschiedenis: liefst een artiest die al in dezelfde stijlgroep zit, anders een huidige favoriet.
  const styleArtists = items.filter((it) => norm(it.style) === norm(current.style)).flatMap((it) => it.track.artists);
  const candidates = pool.filter((t) => fits(t));
  const pick =
    candidates.find((t) => shareArtist(styleArtists, t.artists)) ??
    candidates.find((t) => t.tier === 'nu') ??
    candidates[0];
  if (!pick) return null;
  const { tier: _tier, plays: _plays, ...track } = pick;
  return { item: { track, style: current.style, isNew: false, energy: current.energy }, spares: [...spares, current] };
}
