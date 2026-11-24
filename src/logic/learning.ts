// Leren van skips. De telefoon vangt de Spotify-broadcasts op (nummer gewisseld, afspelen/pauze + positie);
// daaruit maken we "plays" en daaruit de signalen:
// 1. te vaak gedraaid  2. geen zin in (één losse skip van een bekend nummer, per vibe)
// 3. patronen: steeds hetzelfde nummer of steeds nummers van dezelfde artiest geskipt -> eerst minder, daarna weg.
// Eén (snelle) skip maakt iets nooit "niet leuk"; de app vraagt niets, hij kijkt naar herhaling.
// Een reeks skips (2+ op rij) is neutraal: je zoekt dan iets. Losse skips tellen ook in Live DJ gewoon mee.
// Waar je naartoe skipte wordt niet gebruikt: je koos dat nummer niet, het kwam gewoon als volgende.
import type { Learned, NotNowEntry, Pattern, Play, Signals } from './types.ts';
import { vibeGroup } from './profiles.ts';
import { norm, songKey } from './text.ts';

/** Ruwe gebeurtenis zoals de native module die wegschrijft. */
export type RawEvent =
  | { t: number; type: 'meta'; id: string; name: string; artist: string; length: number }
  | { t: number; type: 'state'; playing: boolean; pos: number };

/** Het nummer dat nu loopt (nog niet afgesloten). */
export type OpenSeg = {
  id: string;
  name: string;
  artist: string;
  lengthMs: number;
  start: number;
  lastPos: number;
  lastT: number;
  playing: boolean;
  maxPos: number;
};

const SESSION_GAP = 30 * 60 * 1000;
const DUPLICATE_WINDOW = 4000;

export function isFull(listenedMs: number, lengthMs: number): boolean {
  if (!lengthMs) return false;
  return listenedMs >= lengthMs * 0.9 || lengthMs - listenedMs <= 10_000;
}

function position(seg: OpenSeg, t: number): number {
  const est = seg.lastPos + (seg.playing ? Math.max(0, t - seg.lastT) : 0);
  return Math.min(seg.lengthMs || Infinity, Math.max(seg.maxPos, est));
}

function close(seg: OpenSeg, t: number, nextStarted: boolean): Play | null {
  const listenedMs = Math.round(position(seg, t));
  const full = isFull(listenedMs, seg.lengthMs);
  if (!full && !nextStarted) return null; // gestopt met luisteren: geen skip
  return {
    id: seg.id,
    name: seg.name,
    artist: seg.artist,
    lengthMs: seg.lengthMs,
    start: seg.start,
    listenedMs,
    outcome: full ? 'full' : 'skip',
  };
}

/** Verwerkt nieuwe gebeurtenissen. Geeft de afgesloten plays en het nummer dat nog loopt. */
export function ingest(open: OpenSeg | null, events: RawEvent[]): { plays: Play[]; open: OpenSeg | null } {
  const plays: Play[] = [];
  let cur = open;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  for (const ev of sorted) {
    if (ev.type === 'state') {
      if (!cur) continue;
      const pos = position(cur, ev.t);
      cur = {
        ...cur,
        maxPos: Math.max(cur.maxPos, pos, Math.min(ev.pos, cur.lengthMs || ev.pos)),
        lastPos: ev.pos,
        lastT: ev.t,
        playing: ev.playing,
      };
      continue;
    }
    // Nummer gewisseld (of hetzelfde nummer opnieuw).
    if (cur && cur.id === ev.id) {
      const pos = position(cur, ev.t);
      const repeat = isFull(pos, cur.lengthMs) || ev.t - cur.start > (cur.lengthMs || 0) * 0.9;
      if (!repeat || ev.t - cur.lastT < DUPLICATE_WINDOW) continue; // dubbele melding van Spotify
    }
    if (cur) {
      const gap = ev.t - cur.lastT;
      const stoppedLongAgo = !cur.playing && gap > SESSION_GAP;
      const p = close(cur, ev.t, !stoppedLongAgo);
      if (p) plays.push(p);
    }
    cur = {
      id: ev.id,
      name: ev.name,
      artist: ev.artist,
      lengthMs: ev.length,
      start: ev.t,
      lastPos: 0,
      lastT: ev.t,
      playing: true,
      maxPos: 0,
    };
  }
  return { plays, open: cur };
}

/** Koppelt plays aan de vibe van de wachtrij waar ze uit kwamen (voorstel van max. 6 uur oud). */
export function tagPlays(
  plays: Play[],
  plans: { vibe: string; createdAt: number; ids: string[]; newIds: string[] }[],
  live?: { vibe: string; startedAt: number; ids: string[]; newIds: string[] } | null,
): Play[] {
  return plays.map((p) => {
    if (p.vibe) return p;
    const plan = [...plans]
      .filter((pl) => pl.createdAt <= p.start && p.start - pl.createdAt < 6 * 3600 * 1000 && pl.ids.includes(p.id))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (plan) return { ...p, vibe: plan.vibe, fromPlanNew: plan.newIds.includes(p.id) };
    // Live DJ: alles wat de DJ in deze sessie klaarzette (ook reserves) hoort bij de Live-vibe.
    if (live && p.start >= live.startedAt - 60_000 && live.ids.includes(p.id)) {
      return { ...p, vibe: live.vibe, fromPlanNew: live.newIds.includes(p.id) };
    }
    return p;
  });
}

// ---------- signalen ----------

export const REST_WINDOW_DAYS = 4; // "de laatste dagen"
export const REST_MIN_PLAYS = 5; // zo vaak helemaal gehoord = te vaak
export const REST_DAYS = 14; // ongeveer 2 weken rust
/**
 * Patronen. Een telende skip = een losse skip (niet in een reeks, niet "had ik vandaag al gehoord").
 * Door de 12-uursregel telt hetzelfde nummer hooguit één skip per halve dag. Helemaal afluisteren zet de teller op 0.
 */
export const PATTERN = {
  knownLess: 2, // bekend nummer 2× geskipt -> minder vaak
  knownGone: 4, // 4× -> waarschijnlijk niet meer leuk
  newLess: 1, // nieuw nummer 1× geskipt -> niet opnieuw voorstellen, nog niet "niet leuk"
  newGone: 2, // nieuw nummer 2× geskipt -> weg
  artistLessSongs: 2, // 2 verschillende nummers van één artiest geskipt (in 2+ sessies) -> minder van die artiest
  artistGoneSongs: 3, // 3 verschillende nummers -> artiest weg
  artistSessions: 2,
};
export const REPEAT_WINDOW_MS = 12 * 3600 * 1000; // net al gehoord: een skip dan is "had ik net al", geen oordeel
export const NOT_NOW_DAYS = 7; // zo lang telt een "geen zin in" uit skips

/** Telt deze "geen zin in" nog? Zelf toegevoegd blijft staan; uit skips verloopt na een week. */
export function notNowActive(e: NotNowEntry, now: number): boolean {
  return !!e.manual || now - e.at < NOT_NOW_DAYS * 86400000;
}

/** Sleutel voor wissen per nummer en vibe(groep). */
export function notNowKey(id: string, vibe: string): string {
  return `${id}|${vibeGroup(vibe)}`;
}

export type SignalInput = {
  /** Track-ids uit je luistergeschiedenis (Spotify): die ken je al. */
  known: Set<string>;
  /** Recent afgespeeld volgens Spotify (ook van je pc): voor "te vaak gedraaid". */
  recentPlays?: { id: string; at: number }[];
  now: number;
};

function sessionsOf(plays: Play[]): Play[][] {
  const out: Play[][] = [];
  let cur: Play[] = [];
  let lastEnd = 0;
  for (const p of plays) {
    if (cur.length && p.start - lastEnd > SESSION_GAP) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
    lastEnd = p.start + p.listenedMs;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function computeSignals(learned: Learned, input: SignalInput): Signals {
  const { now } = input;
  const plays = [...learned.plays].sort((a, b) => a.start - b.start);
  const resting: Record<string, number> = {};
  const notNow: Signals['notNow'] = {};
  const neutral = new Set<Play>();

  // 1. Doorskippen: 2+ skips op rij zijn neutraal (je zoekt iets, het is geen oordeel over die nummers),
  // ook als je daarna nog niets helemaal afluistert.
  const sessions = sessionsOf(plays);
  for (const s of sessions) {
    let run: Play[] = [];
    const flush = () => {
      if (run.length >= 2) run.forEach((r) => neutral.add(r));
      run = [];
    };
    for (const p of s) {
      if (p.outcome === 'skip') run.push(p);
      else flush();
    }
    flush();
  }

  // Herhaling: een skip van een nummer dat je in de 12 uur ervoor al hoorde (bv. Live DJ opnieuw gestart en
  // bijna dezelfde wachtrij) zegt niets over het nummer zelf. Telt niet voor "geen zin in" en niet voor "niet leuk".
  const heardAt = new Map<string, number[]>();
  for (const p of plays) heardAt.set(p.id, [...(heardAt.get(p.id) ?? []), p.start]);
  for (const r of input.recentPlays ?? []) heardAt.set(r.id, [...(heardAt.get(r.id) ?? []), r.at]);
  for (const p of plays) {
    if (p.outcome !== 'skip') continue;
    const before = (heardAt.get(p.id) ?? []).some((t) => t < p.start - 1000 && p.start - t < REPEAT_WINDOW_MS);
    if (before) neutral.add(p);
  }

  // 2. Te vaak gedraaid: in de laatste dagen vaak helemaal gehoord -> 2 weken rust.
  const since = now - REST_WINDOW_DAYS * 86400000;
  const fullRecent = new Map<string, number[]>();
  for (const p of plays) {
    if (p.outcome === 'full' && p.start >= since) fullRecent.set(p.id, [...(fullRecent.get(p.id) ?? []), p.start]);
  }
  const spotifyRecent = new Map<string, number[]>();
  for (const r of input.recentPlays ?? []) {
    if (r.at >= since) spotifyRecent.set(r.id, [...(spotifyRecent.get(r.id) ?? []), r.at]);
  }
  for (const id of new Set([...fullRecent.keys(), ...spotifyRecent.keys()])) {
    const a = fullRecent.get(id) ?? [];
    const b = spotifyRecent.get(id) ?? [];
    const times = a.length >= b.length ? a : b;
    const lifted = learned.unrest?.[id] ?? 0;
    const counted = times.filter((x) => x > lifted);
    if (counted.length >= REST_MIN_PLAYS) resting[id] = Math.max(...counted) + REST_DAYS * 86400000;
  }
  for (const [id, until] of Object.entries(learned.manualRest ?? {})) {
    if (until > now) resting[id] = Math.max(resting[id] ?? 0, until);
  }

  // 3. Geen zin in: een bekend nummer los geskipt (per vibe).
  const firstFull = new Map<string, number>();
  for (const p of plays) if (p.outcome === 'full' && !firstFull.has(p.id)) firstFull.set(p.id, p.start);
  for (const s of sessions) {
    for (const p of s) {
      if (p.outcome !== 'skip' || neutral.has(p)) continue;
      const knownBefore = (input.known.has(p.id) && !p.fromPlanNew) || (firstFull.get(p.id) ?? Infinity) < p.start;
      if (!knownBefore) continue;
      const d = new Date(p.start);
      (notNow[p.id] ??= []).push({ vibe: p.vibe ?? 'zonder vibe', hour: d.getHours(), at: p.start });
    }
  }

  // 4. Patronen: steeds hetzelfde nummer, of steeds nummers van één artiest.
  const patterns = findPatterns(sessions, neutral, learned, input, firstFull);

  // Zelf gewist: skips tot dat moment tellen niet meer. Zelf toegevoegd: komt erbij en verloopt niet.
  const cleared = learned.notNowCleared ?? {};
  for (const id of Object.keys(notNow)) {
    notNow[id] = notNow[id].filter((e) => !((cleared[notNowKey(id, e.vibe)] ?? 0) >= e.at));
    if (!notNow[id].length) delete notNow[id];
  }
  for (const [id, list] of Object.entries(learned.notNowManual ?? {})) {
    for (const m of list) {
      (notNow[id] ??= []).push({ vibe: m.vibe, hour: new Date(m.at).getHours(), at: m.at, manual: true });
    }
  }

  const disliked = Object.entries(learned.decisions)
    .filter(([, d]) => d === 'bevestigd')
    .map(([id]) => id);

  return { resting, notNow, patterns, disliked };
}

/** Hoofdartiest: "Morgan Wallen, Post Malone" -> "Morgan Wallen". */
export function primaryArtist(artist: string): string {
  return (artist.split(/,\s*/)[0] ?? artist).trim();
}

/** Sleutel van een artiest om te vergelijken (zelfde als in songKey). */
export function artistKey(artist: string): string {
  return norm(primaryArtist(artist));
}

function dm(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}-${d.getMonth() + 1}`;
}

/** Eén vibe-groep waar alles gebeurde (behalve Standaard en zonder vibe): dan geldt het patroon alleen daar. */
function scopeOf(skips: Play[]): string | null {
  const groups = new Set(skips.map((p) => vibeGroup(p.vibe)));
  if (groups.size !== 1) return null;
  const g = [...groups][0];
  return g === 'standaard' || g === 'zonder vibe' ? null : g;
}

type Ev = { p: Play; si: number };

function findPatterns(sessions: Play[][], neutral: Set<Play>, learned: Learned, input: SignalInput, firstFull: Map<string, number>): Pattern[] {
  const cleared = learned.notNowCleared ?? {};
  // Alles behalve neutrale skips, op volgorde. Een skip die je bij "geen zin in" zelf wiste telt ook niet.
  const events: Ev[] = [];
  sessions.forEach((s, si) => {
    for (const p of s) {
      if (p.outcome === 'skip' && (neutral.has(p) || (cleared[notNowKey(p.id, p.vibe ?? 'zonder vibe')] ?? 0) >= p.start)) continue;
      events.push({ p, si });
    }
  });

  /** Telende skips sinds de laatste keer helemaal afgeluisterd (en sinds `since`). */
  const streakOf = (evs: Ev[], since: number): Ev[] => {
    let streak: Ev[] = [];
    for (const ev of evs) {
      if (ev.p.start <= since) continue;
      if (ev.p.outcome === 'full') streak = [];
      else streak.push(ev);
    }
    return streak;
  };

  const out: Pattern[] = [];

  // Per nummer.
  const bySong = new Map<string, Ev[]>();
  for (const ev of events) {
    const list = bySong.get(ev.p.id);
    if (list) list.push(ev);
    else bySong.set(ev.p.id, [ev]);
  }
  for (const [id, evs] of bySong) {
    if (learned.decisions[id] === 'bevestigd') continue; // staat al op "nooit meer"
    const approved = learned.decisions[id] === 'afgewezen' ? learned.asked[id] ?? 0 : 0; // "toch leuk": telt opnieuw vanaf dan
    const streak = streakOf(evs, approved);
    if (!streak.length) continue;
    const skips = streak.map((e) => e.p);
    const heardFull = (firstFull.get(id) ?? Infinity) < skips[0].start;
    const isNew = !heardFull && (!input.known.has(id) || skips.some((p) => p.fromPlanNew));
    const n = skips.length;
    const level = isNew ? (n >= PATTERN.newGone ? 'weg' : n >= PATTERN.newLess ? 'minder' : null) : n >= PATTERN.knownGone ? 'weg' : n >= PATTERN.knownLess ? 'minder' : null;
    if (!level) continue;
    const last = skips[n - 1];
    out.push({
      kind: 'song',
      key: id,
      name: last.name,
      artist: last.artist,
      level,
      skips: n,
      songs: 1,
      isNew,
      vibe: scopeOf(skips),
      first: skips[0].start,
      last: last.start,
      reason: isNew ? `nieuw, ${n}× geskipt` : `${n}× geskipt sinds ${dm(skips[0].start)}, niet meer afgeluisterd`,
    });
  }

  // Per artiest: verschillende nummers steeds geskipt, in meer dan één sessie, en niets van hem afgeluisterd.
  const byArtist = new Map<string, Ev[]>();
  for (const ev of events) {
    const k = artistKey(ev.p.artist);
    if (!k) continue;
    const list = byArtist.get(k);
    if (list) list.push(ev);
    else byArtist.set(k, [ev]);
  }
  for (const [key, evs] of byArtist) {
    const ok = learned.artistOk?.[key]?.at ?? 0;
    const streak = streakOf(evs, ok);
    const songs = new Set(streak.map((e) => e.p.id)).size;
    const sessionsN = new Set(streak.map((e) => e.si)).size;
    if (sessionsN < PATTERN.artistSessions) continue;
    const level = songs >= PATTERN.artistGoneSongs ? 'weg' : songs >= PATTERN.artistLessSongs ? 'minder' : null;
    if (!level) continue;
    const skips = streak.map((e) => e.p);
    const last = skips[skips.length - 1];
    out.push({
      kind: 'artist',
      key,
      name: primaryArtist(last.artist),
      artist: primaryArtist(last.artist),
      level,
      skips: skips.length,
      songs,
      isNew: false,
      vibe: scopeOf(skips),
      first: skips[0].start,
      last: last.start,
      reason: `${songs} verschillende nummers geskipt sinds ${dm(skips[0].start)}, niets van afgeluisterd`,
    });
  }

  return out.sort((a, b) => (a.level === b.level ? b.last - a.last : a.level === 'weg' ? -1 : 1));
}

/** Geldt dit patroon bij deze vibe? (null = overal) */
export function patternApplies(p: Pattern, vibeText: string | null | undefined): boolean {
  return p.vibe === null || vibeGroup(vibeText) === p.vibe;
}

/** Het sterkste patroon dat bij dit nummer hoort (zelf, of via de hoofdartiest), bij deze vibe. */
export function patternFor(signals: Signals, track: { id: string; artists: string[] }, vibeText: string | null | undefined): Pattern | null {
  const a = norm(track.artists[0] ?? '');
  let best: Pattern | null = null;
  for (const p of signals.patterns ?? []) {
    const hit = p.kind === 'song' ? p.key === track.id : !!a && p.key === a;
    if (!hit || !patternApplies(p, vibeText)) continue;
    if (!best || (p.level === 'weg' && best.level !== 'weg')) best = p;
  }
  return best;
}

/** Sleutels (titel + artiest) van niet-leuke nummers (door jou, of overal "weg"): vangt ook andere versies af. */
export function dislikedKeys(signals: Signals, learned: Learned): Set<string> {
  const keys = new Set<string>();
  for (const id of signals.disliked) {
    const m = learned.meta[id];
    if (m) keys.add(songKey(m.name, [m.artist]));
  }
  for (const p of signals.patterns ?? []) {
    if (p.kind === 'song' && p.level === 'weg' && p.vibe === null) keys.add(songKey(p.name, [p.artist]));
  }
  return keys;
}

/** Artiest "toch leuk": skips van daarvoor tellen niet meer. */
export function approveArtist(learned: Learned, p: { key: string; name: string }, now: number): Learned {
  return { ...learned, artistOk: { ...(learned.artistOk ?? {}), [p.key]: { name: p.name, at: now } } };
}

/** "Toch leuk" bij een artiest weer wissen. */
export function unapproveArtist(learned: Learned, key: string): Learned {
  const artistOk = { ...(learned.artistOk ?? {}) };
  delete artistOk[key];
  return { ...learned, artistOk };
}

/** Houdt plays van de laatste 60 dagen (en maximaal 4000). */
export function prunePlays(plays: Play[], now: number): Play[] {
  const since = now - 60 * 86400000;
  return plays.filter((p) => p.start >= since).slice(-4000);
}

export const EMPTY_LEARNED: Learned = { plays: [], decisions: {}, asked: {}, meta: {}, manualRest: {} };

// ---------- "geen zin in" zelf beheren ----------

export type NotNowLine = { id: string; vibe: string; at: number; manual: boolean };
export type NotNowGroup = { group: string; vibe: string; lines: NotNowLine[] };

/** Actieve "geen zin in" per vibe(groep), nieuwste eerst. `vibe` = een vibe-tekst uit die groep (om mee te bewerken). */
export function notNowGroups(signals: Signals, now: number): NotNowGroup[] {
  const groups = new Map<string, NotNowGroup>();
  for (const [id, list] of Object.entries(signals.notNow)) {
    const seen = new Set<string>();
    for (const e of [...list].sort((a, b) => b.at - a.at)) {
      if (!notNowActive(e, now)) continue;
      const g = vibeGroup(e.vibe);
      if (seen.has(g)) continue; // één regel per nummer per groep
      seen.add(g);
      if (!groups.has(g)) groups.set(g, { group: g, vibe: e.vibe, lines: [] });
      groups.get(g)!.lines.push({ id, vibe: e.vibe, at: e.at, manual: !!e.manual });
    }
  }
  const out = [...groups.values()];
  for (const g of out) g.lines.sort((a, b) => b.at - a.at);
  return out.sort((a, b) => b.lines.length - a.lines.length || a.group.localeCompare(b.group));
}

/** Wist "geen zin in" voor dit nummer bij deze vibe(groep): skips tot nu tellen niet meer, zelf toegevoegd gaat weg. */
export function removeNotNow(learned: Learned, id: string, vibe: string, now: number): Learned {
  const key = notNowKey(id, vibe);
  const group = vibeGroup(vibe);
  const manual = { ...(learned.notNowManual ?? {}) };
  const rest = (manual[id] ?? []).filter((m) => vibeGroup(m.vibe) !== group);
  if (rest.length) manual[id] = rest;
  else delete manual[id];
  return { ...learned, notNowManual: manual, notNowCleared: { ...(learned.notNowCleared ?? {}), [key]: now } };
}

/** Zelf toevoegen: dit nummer niet bij deze vibe(groep), tot je het weer weghaalt. */
export function addNotNow(learned: Learned, id: string, vibe: string, now: number, meta?: { name: string; artist: string }): Learned {
  const v = vibe.trim();
  if (!v) return learned;
  const group = vibeGroup(v);
  const manual = { ...(learned.notNowManual ?? {}) };
  manual[id] = [...(manual[id] ?? []).filter((m) => vibeGroup(m.vibe) !== group), { vibe: v, at: now }];
  return { ...learned, notNowManual: manual, meta: meta ? { ...learned.meta, [id]: meta } : learned.meta };
}

/** Naar een andere vibe verplaatsen (= bij de oude wissen, bij de nieuwe toevoegen). */
export function moveNotNow(learned: Learned, id: string, from: string, to: string, now: number): Learned {
  if (vibeGroup(from) === vibeGroup(to)) return learned;
  return addNotNow(removeNotNow(learned, id, from, now), id, to, now);
}

/** Alles bij één vibe(groep) wissen. */
export function clearNotNowGroup(learned: Learned, group: NotNowGroup, now: number): Learned {
  return group.lines.reduce((l, line) => removeNotNow(l, line.id, line.vibe, now), learned);
}
