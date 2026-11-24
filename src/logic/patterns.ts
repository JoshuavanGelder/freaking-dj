// Patronen in je skips: de app zoekt zelf uit wat je niet (meer) leuk vindt, zonder iets te vragen.
// Gebaseerd op wat Spotify/Deezer/Pandora doen en onderzoek naar skips (zie overdracht 24-11):
// - één skip zegt niks; een patroon wel (steeds hetzelfde nummer, of steeds nummers van één artiest)
// - per leergroep: Gym en Worship apart, de rest (Standaard en vrije vibes) samen; overal pas als het in 2+ groepen speelt
// - een skip binnen 30 s telt helemaal, tot de helft half, na de helft niet (dan wilde je gewoon iets anders)
// - oude skips (> 30 dagen) tellen half; "minder" vervalt na 30 dagen zonder nieuwe skip
// - "weg" pas als het over meerdere dagen gebeurt; vastgelegd met datum; na 8 weken één keer terug als test
// - een favoriet die je vaak hoorde en nu steeds skipt is verzadigd, niet "niet leuk": 30 dagen pauze
// - versies samen (Remastered, Radio Edit), live en remix apart; featured artiesten tellen niet voor de artiest
import type { Learned, LearnGroup, Pattern, Play, Signals, StyleHint, Verdict } from './types.ts';
import { profileOf, vibeGroup } from './profiles.ts';
import { norm } from './text.ts';

const DAY = 86400000;

export const PATTERN = {
  quickMs: 30_000, // skip binnen 30 s: telt helemaal; tot de helft: half; na de helft: telt niet (en zet de teller ook niet op 0)
  oldDays: 30, // telskips ouder dan 30 dagen tellen half
  knownLess: 2, // bekend nummer: 2 (in 2+ sessies) -> minder vaak
  knownGone: 4, // 4, verspreid over 3+ dagen -> weg
  knownGoneDays: 3,
  newLess: 0.5, // nieuw nummer: één skip in de eerste helft -> niet opnieuw voorstellen
  newGone: 1.5, // nieuw nummer: nog een keer (andere sessie) -> weg
  artistLess: 2, // artiest: 2 verschillende nummers (in 2+ sessies) -> minder van die artiest
  artistGone: 3, // 3 verschillende nummers, verspreid over 3+ dagen -> artiest weg
  artistGoneDays: 3,
  runWeight: 0.5, // skip in een reeks: normaal neutraal, maar telt half als het nummer of de artiest al op "minder" staat
  lessExpireDays: 30, // zonder nieuwe telskip in 30 dagen vervalt een patroon
  saturatedFulls: 3, // 3+ keer helemaal gehoord in de 30 dagen ervoor = verzadigd
  saturatedDays: 30,
  pauseDays: 30, // verzadigd: 30 dagen pauze in plaats van "weg"
  goneWeeks: 8, // weg: 8 weken, dan één keer als test
  regoneWeeks: 16, // na een mislukte test: 16 weken
  testDays: 30, // zo lang mag het na de periode als test terugkomen (niet vooraan)
  liveWindowDays: 14, // Live DJ skipt vaker (je weet niet wat er komt): vergelijk de laatste 2 weken
  liveMinPlays: 40,
  liveGap: 0.1, // 10 procentpunt vaker skippen in Live DJ...
  liveFactor: 0.75, // ...dan tellen Live DJ-skips voor 0,75 (≈ één skip extra nodig)
  styleArtists: 3, // stijl-hint: 3+ verschillende artiesten van één stijl geskipt
  styleSessions: 2,
  styleShare: 0.5, // en minstens de helft van die stijl geskipt
  styleDays: 30,
};

/** Leergroep van een vibe: Gym, Worship, of Standaard (alles anders, ook vrije vibes en zonder vibe). */
export function learnGroup(vibe: string | null | undefined): LearnGroup {
  const p = profileOf(vibe);
  return p === 'gym' || p === 'worship' ? p : 'standaard';
}

export const GROUP_WHERE: Record<LearnGroup, string> = { standaard: 'buiten de gym', gym: 'alleen in de gym', worship: 'alleen bij worship' };

/** Hoofdartiest: "Morgan Wallen, Post Malone" -> "Morgan Wallen". */
export function primaryArtist(artist: string): string {
  return (artist.split(/,\s*/)[0] ?? artist).trim();
}

/** Sleutel van een artiest om te vergelijken (zelfde als in songKey). */
export function artistKey(artist: string): string {
  return norm(primaryArtist(artist));
}

const KEEP = /\b(live|remix|mix|acoustic|akoestisch|unplugged|instrumental|cover|sped up|slowed)\b/i;
const DROP = /\b(feat|ft|with|remaster(ed)?|radio edit|edit|single version|album version|version|mono|stereo|deluxe|bonus|(19|20)\d\d)\b/i;

/** Hetzelfde nummer in een andere uitgave (Remastered, Radio Edit, feat.) telt samen; live en remix blijven apart. */
export function countKey(title: string, artist: string): string {
  let t = title.replace(/\s*[\(\[]([^\)\]]*)[\)\]]/g, (m, inner: string) => (DROP.test(inner) && !KEEP.test(inner) ? '' : m));
  t = t.replace(/\s+-\s+(.*)$/, (m, tail: string) => (DROP.test(tail) && !KEEP.test(tail) ? '' : m));
  return `${norm(t)}|${artistKey(artist)}`;
}

function dm(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}-${d.getMonth() + 1}`;
}

function dayOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type Ev = {
  p: Play;
  si: number; // sessie
  group: LearnGroup;
  song: string;
  artist: string;
  full: boolean;
  w: number; // gewicht van een skip (0 bij helemaal afgeluisterd)
  run: boolean; // zat in een reeks skips
  quick: boolean; // binnen 30 s
};

export type PatternInput = {
  sessions: Play[][];
  inRun: Set<Play>;
  repeat: Set<Play>;
  learned: Learned;
  known: Set<string>;
  knownKeys?: Set<string>;
  recentPlays?: { id: string; at: number }[];
  blockedArtists?: string[];
  now: number;
};

/** Skippen in Live DJ duidelijk vaker dan bij een gewone wachtrij? Dan tellen Live DJ-skips iets minder. */
export function liveFactor(plays: Play[], now: number): number {
  const recent = plays.filter((p) => now - p.start < PATTERN.liveWindowDays * DAY && p.vibe);
  const live = recent.filter((p) => p.live);
  const queue = recent.filter((p) => !p.live);
  if (live.length < PATTERN.liveMinPlays || queue.length < PATTERN.liveMinPlays) return 1;
  const rate = (l: Play[]) => l.filter((p) => p.outcome === 'skip').length / l.length;
  return rate(live) - rate(queue) >= PATTERN.liveGap ? PATTERN.liveFactor : 1;
}

/** Gewicht van een losse skip: luisterduur × ouderdom × Live DJ. */
export function skipWeight(p: Play, now: number, live = 1): number {
  const dur = p.listenedMs < PATTERN.quickMs ? 1 : !p.lengthMs || p.listenedMs < p.lengthMs / 2 ? 0.5 : 0;
  const age = now - p.start > PATTERN.oldDays * DAY ? 0.5 : 1;
  return dur * age * (p.live ? live : 1);
}

type Stats = { sum: number; songs: number; songScore: number; sessions: number; days: number; first: number; last: number; n: number };

function statsOf(skips: Ev[]): Stats {
  const perSong = new Map<string, number>();
  for (const e of skips) perSong.set(e.song, Math.max(perSong.get(e.song) ?? 0, e.w));
  return {
    sum: skips.reduce((a, e) => a + e.w, 0),
    songs: perSong.size,
    songScore: [...perSong.values()].reduce((a, b) => a + b, 0),
    sessions: new Set(skips.map((e) => e.si)).size,
    days: new Set(skips.map((e) => dayOf(e.p.start))).size,
    first: skips[0]?.p.start ?? 0,
    last: skips[skips.length - 1]?.p.start ?? 0,
    n: skips.length,
  };
}

export function verdictKey(kind: 'song' | 'artist', key: string, group: LearnGroup): string {
  return `${kind}:${key}@${group}`;
}

const STRENGTH: Record<Pattern['level'], number> = { minder: 1, pauze: 2, weg: 3 };

/**
 * Zoekt de patronen. Geeft ook de bijgewerkte oordelen terug (nieuw "weg"/"pauze", verlopen, mislukte test, opgeheven).
 * Puur: zelfde invoer = zelfde uitkomst, zodat het scherm en het opslaan altijd hetzelfde zien.
 */
export function evaluatePatterns(x: PatternInput): { patterns: Pattern[]; verdicts: Record<string, Verdict>; styles: StyleHint[] } {
  const { learned, now } = x;
  const plays = x.sessions.flat();
  const lf = liveFactor(plays, now);
  const cleared = learned.notNowCleared ?? {};
  const blocked = new Set((x.blockedArtists ?? []).map(norm));
  const verdicts: Record<string, Verdict> = { ...(learned.verdicts ?? {}) };

  // Gebeurtenissen. Herhalingen (al gehoord in de 12 uur ervoor), zelf gewiste skips en late skips (na de helft) doen niet mee.
  const events: Ev[] = [];
  x.sessions.forEach((s, si) => {
    for (const p of s) {
      const base = { p, si, group: learnGroup(p.vibe), song: countKey(p.name, p.artist), artist: artistKey(p.artist), run: false, quick: false };
      if (p.outcome === 'full') {
        events.push({ ...base, full: true, w: 0 });
        continue;
      }
      if (x.repeat.has(p)) continue;
      if ((cleared[`${p.id}|${vibeGroup(p.vibe ?? 'zonder vibe')}`] ?? 0) >= p.start) continue;
      const w = skipWeight(p, now, lf);
      if (w <= 0) continue;
      events.push({ ...base, full: false, w, run: x.inRun.has(p), quick: p.listenedMs < PATTERN.quickMs });
    }
  });

  const bySong = new Map<string, Ev[]>();
  const byArtist = new Map<string, Ev[]>();
  for (const e of events) {
    const a = bySong.get(e.song);
    if (a) a.push(e);
    else bySong.set(e.song, [e]);
    if (!e.artist) continue;
    const b = byArtist.get(e.artist);
    if (b) b.push(e);
    else byArtist.set(e.artist, [e]);
  }

  // "Toch leuk" en "nooit meer" (ook oude antwoorden per track-id).
  const songIds = (evs: Ev[]) => [...new Set(evs.map((e) => e.p.id))];
  const songApproved = (key: string, ids: string[]) =>
    Math.max(learned.songOk?.[key]?.at ?? 0, ...ids.map((id) => (learned.decisions[id] === 'afgewezen' ? learned.asked[id] ?? 0 : 0)));
  const songNever = (ids: string[]) => ids.some((id) => learned.decisions[id] === 'bevestigd');

  /** Telskips sinds de laatste keer helemaal afgeluisterd in deze groep (en sinds `from`). */
  const streak = (evs: Ev[], group: LearnGroup, from: number, allowRun: (e: Ev) => boolean): Ev[] => {
    let s: Ev[] = [];
    for (const e of evs) {
      if (e.group !== group || e.p.start <= from) continue;
      if (e.full) s = [];
      else if (!e.run) s.push(e);
      else if (allowRun(e)) s.push({ ...e, w: Math.min(e.w, PATTERN.runWeight) });
    }
    return s;
  };

  const knownBefore = (key: string, ids: string[], skips: Ev[], evs: Ev[]): boolean => {
    const t1 = skips[0]?.p.start ?? 0;
    if (evs.some((e) => e.full && e.p.start < t1)) return true; // al eens helemaal gehoord
    const inHistory = ids.some((id) => x.known.has(id)) || !!x.knownKeys?.has(key);
    return inHistory && !skips.some((e) => e.p.fromPlanNew);
  };

  const saturated = (ids: string[], evs: Ev[], t1: number): boolean => {
    const from = t1 - PATTERN.saturatedDays * DAY;
    const app = evs.filter((e) => e.full && e.p.start >= from && e.p.start < t1).length;
    const spotify = (x.recentPlays ?? []).filter((r) => ids.includes(r.id) && r.at >= from && r.at < t1).length;
    return Math.max(app, spotify) >= PATTERN.saturatedFulls;
  };

  type Judged = { level: Pattern['level']; st: Stats; isNew: boolean; reason: string } | null;

  const judgeSong = (key: string, evs: Ev[], skips: Ev[]): Judged => {
    if (!skips.length) return null;
    const st = statsOf(skips);
    if (now - st.last > PATTERN.lessExpireDays * DAY) return null;
    const ids = songIds(evs);
    const isNew = !knownBefore(key, ids, skips, evs);
    if (isNew) {
      if (st.sum >= PATTERN.newGone && st.sessions >= 2) return { level: 'weg', st, isNew, reason: `nieuw, ${st.n}× geskipt` };
      if (st.sum >= PATTERN.newLess) return { level: 'minder', st, isNew, reason: `nieuw, ${st.n}× geskipt` };
      return null;
    }
    if (st.sum >= PATTERN.knownGone && st.days >= PATTERN.knownGoneDays) {
      if (saturated(ids, evs, st.first)) return { level: 'pauze', st, isNew, reason: 'vaak gehoord en nu steeds geskipt: even te vaak gehoord' };
      return { level: 'weg', st, isNew, reason: `${st.n}× geskipt op ${st.days} dagen, niet meer afgeluisterd` };
    }
    if (st.sum >= PATTERN.knownLess && st.sessions >= 2) return { level: 'minder', st, isNew, reason: `${st.n}× geskipt sinds ${dm(st.first)}` };
    return null;
  };

  const judgeArtist = (skips: Ev[]): Judged => {
    if (!skips.length) return null;
    const st = statsOf(skips);
    if (now - st.last > PATTERN.lessExpireDays * DAY) return null;
    const reason = `${st.songs} verschillende nummers geskipt sinds ${dm(st.first)}, niets van afgeluisterd`;
    if (st.songScore >= PATTERN.artistGone && st.songs >= PATTERN.artistGone && st.days >= PATTERN.artistGoneDays) return { level: 'weg', st, isNew: false, reason };
    if (st.songScore >= PATTERN.artistLess && st.songs >= PATTERN.artistLess && st.sessions >= 2) return { level: 'minder', st, isNew: false, reason };
    return null;
  };

  const groups: LearnGroup[] = ['standaard', 'gym', 'worship'];

  // Ronde 1 (zonder reeksen): wat staat al op "minder" of erger? Dan tellen reeks-skips daarvan in ronde 2 half mee.
  const flagged = new Set<string>();
  for (const [key, evs] of bySong) {
    const from = songApproved(key, songIds(evs));
    for (const g of groups) if (judgeSong(key, evs, streak(evs, g, from, () => false))) flagged.add(`s:${key}@${g}`);
  }
  for (const [key, evs] of byArtist) {
    const from = learned.artistOk?.[key]?.at ?? 0;
    for (const g of groups) if (judgeArtist(streak(evs, g, from, () => false))) flagged.add(`a:${key}@${g}`);
  }
  const allowRun = (e: Ev) => flagged.has(`s:${e.song}@${e.group}`) || flagged.has(`a:${e.artist}@${e.group}`);

  const out: Pattern[] = [];

  /** Eén item (nummer of artiest) in één groep, met de vastgelegde oordelen erbij. */
  const judgeItem = (kind: 'song' | 'artist', key: string, evs: Ev[], group: LearnGroup, approvedAt: number): Pattern | null => {
    const vk = verdictKey(kind, key, group);
    let v: Verdict | undefined = verdicts[vk];
    let from = approvedAt;
    if (v && v.since <= approvedAt) {
      delete verdicts[vk]; // "toch leuk" na het oordeel
      v = undefined;
    }
    const mine = evs.filter((e) => e.group === group);
    if (v) {
      const since = v.since;
      if (mine.some((e) => e.full && e.p.start > since)) {
        delete verdicts[vk]; // zelf helemaal afgeluisterd: telling begint opnieuw
        v = undefined;
      }
    }
    const last = mine[mine.length - 1]?.p ?? evs[evs.length - 1]?.p;
    const base = {
      kind,
      key,
      id: kind === 'song' ? last?.id ?? key : key,
      name: kind === 'song' ? last?.name ?? v?.name ?? key : primaryArtist(last?.artist ?? v?.name ?? key),
      artist: kind === 'song' ? last?.artist ?? v?.artist ?? '' : primaryArtist(last?.artist ?? v?.name ?? key),
    };
    const fromVerdict = (vv: Verdict, s?: Stats): Pattern => ({
      ...base,
      name: base.name || vv.name,
      level: vv.level,
      phase: 'nu',
      skips: s?.n ?? 0,
      songs: s?.songs ?? 1,
      isNew: false,
      vibe: group,
      first: vv.since,
      last: vv.since,
      until: vv.until,
      reason: vv.reason,
    });
    if (v && now < v.until) return fromVerdict(v);

    let testPhase = false;
    if (v) {
      from = Math.max(from, v.until);
      if (v.level === 'weg') {
        const vv = v;
        const fail = mine.find((e) => !e.full && !e.run && e.quick && e.p.start > vv.until);
        if (fail) {
          const nv: Verdict = { ...vv, round: vv.round + 1, since: fail.p.start, until: fail.p.start + PATTERN.regoneWeeks * 7 * DAY, reason: `na ${PATTERN.goneWeeks} weken weer snel geskipt` };
          verdicts[vk] = nv;
          if (now < nv.until) return fromVerdict(nv);
        }
        testPhase = now < vv.until + PATTERN.testDays * DAY;
      }
    }

    const skips = streak(evs, group, from, allowRun);
    const j = kind === 'song' ? judgeSong(key, evs, skips) : judgeArtist(skips);
    if (j && (j.level === 'weg' || j.level === 'pauze')) {
      const round = v && v.level === 'weg' && j.level === 'weg' ? v.round + 1 : 1;
      const len = j.level === 'pauze' ? PATTERN.pauseDays * DAY : (round === 1 ? PATTERN.goneWeeks : PATTERN.regoneWeeks) * 7 * DAY;
      const nv: Verdict = {
        kind,
        key,
        group,
        level: j.level,
        name: base.name,
        artist: base.artist,
        ...(kind === 'song' ? { id: base.id } : {}),
        since: j.st.last,
        until: j.st.last + len,
        round,
        reason: j.reason,
      };
      verdicts[vk] = nv;
      if (now < nv.until) return { ...fromVerdict(nv, j.st), isNew: j.isNew, first: j.st.first, last: j.st.last };
      testPhase = nv.level === 'weg' && now < nv.until + PATTERN.testDays * DAY;
    }
    if (testPhase) {
      const weeks = v ? Math.round((v.until - v.since) / (7 * DAY)) : PATTERN.goneWeeks;
      return { ...base, level: 'minder', phase: 'test', skips: skips.length, songs: 1, isNew: false, vibe: group, first: v?.since ?? 0, last: v?.since ?? 0, reason: `was ${weeks} weken weg; mag één keer terugkomen als test` };
    }
    if (j?.level === 'minder') {
      return { ...base, level: 'minder', phase: 'nu', skips: j.st.n, songs: j.st.songs, isNew: j.isNew, vibe: group, first: j.st.first, last: j.st.last, reason: j.reason };
    }
    return null;
  };

  const collect = (kind: 'song' | 'artist', key: string, evs: Ev[], approvedAt: number) => {
    const found = groups.map((g) => judgeItem(kind, key, evs, g, approvedAt)).filter((p): p is Pattern => !!p);
    // Overal pas als het in 2+ groepen "weg" is. Verzadiging (pauze) gaat over het nummer zelf: overal.
    const gone = found.filter((p) => p.level === 'weg' && p.phase === 'nu');
    if (gone.length >= 2) {
      const newest = gone.sort((a, b) => b.last - a.last)[0];
      out.push({ ...newest, vibe: null, until: Math.max(...gone.map((p) => p.until ?? 0)) });
      out.push(...found.filter((p) => !gone.includes(p)));
      return;
    }
    for (const p of found) out.push(p.level === 'pauze' ? { ...p, vibe: null } : p);
  };

  for (const [key, evs] of bySong) {
    const ids = songIds(evs);
    if (songNever(ids)) continue; // staat al op "nooit meer"
    collect('song', key, evs, songApproved(key, ids));
  }
  for (const [key, evs] of byArtist) {
    if (blocked.has(key)) continue; // staat al op de blocklist
    collect('artist', key, evs, learned.artistOk?.[key]?.at ?? 0);
  }
  // Oordelen zonder plays meer (opgeschoond) blijven gelden tot hun datum.
  for (const v of Object.values(verdicts)) {
    if (now >= v.until) continue;
    const has = out.some((p) => p.kind === v.kind && p.key === v.key && (p.vibe === v.group || p.vibe === null));
    if (has) continue;
    if (v.kind === 'artist' && blocked.has(v.key)) continue;
    out.push({ kind: v.kind, key: v.key, id: v.id ?? v.key, name: v.name, artist: v.artist, level: v.level, phase: 'nu', skips: 0, songs: 1, isNew: false, vibe: v.level === 'pauze' ? null : v.group, first: v.since, last: v.since, until: v.until, reason: v.reason });
  }

  out.sort((a, b) => STRENGTH[b.level] - STRENGTH[a.level] || b.last - a.last);
  return { patterns: out, verdicts, styles: styleHints(events, now) };
}

/** Stijlen die je in een groep de laatste tijd vaak skipt, bij verschillende artiesten (alleen een hint aan Claude). */
function styleHints(events: Ev[], now: number): StyleHint[] {
  const per = new Map<string, { group: LearnGroup; style: string; artists: Set<string>; sessions: Set<number>; skips: number; fulls: number }>();
  for (const e of events) {
    if (!e.p.style || now - e.p.start > PATTERN.styleDays * DAY || (!e.full && e.run)) continue;
    const k = `${e.group}|${norm(e.p.style)}`;
    const s = per.get(k) ?? { group: e.group, style: e.p.style, artists: new Set<string>(), sessions: new Set<number>(), skips: 0, fulls: 0 };
    if (e.full) s.fulls++;
    else {
      s.skips++;
      s.artists.add(e.artist);
      s.sessions.add(e.si);
    }
    per.set(k, s);
  }
  return [...per.values()]
    .filter((s) => s.artists.size >= PATTERN.styleArtists && s.sessions.size >= PATTERN.styleSessions && s.skips / (s.skips + s.fulls) >= PATTERN.styleShare)
    .map((s) => ({ group: s.group, style: s.style, artists: s.artists.size, skips: s.skips, fulls: s.fulls }));
}

/** Geldt dit patroon bij deze vibe? (null = overal) */
export function patternApplies(p: Pattern, vibeText: string | null | undefined): boolean {
  return p.vibe === null || learnGroup(vibeText) === p.vibe;
}

/** Het sterkste patroon bij dit nummer (zelf, of via de hoofdartiest), bij deze vibe. */
export function patternFor(signals: Signals, track: { id: string; name: string; artists: string[] }, vibeText: string | null | undefined): Pattern | null {
  const a = norm(track.artists[0] ?? '');
  const song = countKey(track.name, track.artists[0] ?? '');
  let best: Pattern | null = null;
  for (const p of signals.patterns ?? []) {
    const hit = p.kind === 'song' ? p.key === song || p.id === track.id : !!a && p.key === a;
    if (!hit || !patternApplies(p, vibeText)) continue;
    if (!best || STRENGTH[p.level] > STRENGTH[best.level]) best = p;
  }
  return best;
}

/** Wist de oordelen voor dit nummer of deze artiest (alle groepen). */
function dropVerdicts(learned: Learned, kind: 'song' | 'artist', key: string): Record<string, Verdict> {
  const out: Record<string, Verdict> = {};
  for (const [k, v] of Object.entries(learned.verdicts ?? {})) if (!(v.kind === kind && v.key === key)) out[k] = v;
  return out;
}

/** "Toch leuk": skips tot nu tellen niet meer, oordelen weg. Skip je het daarna weer steeds, dan merkt de DJ dat opnieuw. */
export function approvePattern(learned: Learned, p: { kind: 'song' | 'artist'; key: string; name: string; artist: string }, now: number): Learned {
  const verdicts = dropVerdicts(learned, p.kind, p.key);
  if (p.kind === 'artist') return { ...learned, verdicts, artistOk: { ...(learned.artistOk ?? {}), [p.key]: { name: p.name, at: now } } };
  return { ...learned, verdicts, songOk: { ...(learned.songOk ?? {}), [p.key]: { name: p.name, artist: p.artist, at: now } } };
}

/** "Nooit meer" bij een nummer: vast niet-leuk (alle versies via dislikedKeys). Artiest gaat via de blocklist. */
export function neverPattern(learned: Learned, p: { kind: 'song' | 'artist'; key: string; id: string; name: string; artist: string }, now: number): Learned {
  const verdicts = dropVerdicts(learned, p.kind, p.key);
  if (p.kind === 'artist') return { ...learned, verdicts };
  return {
    ...learned,
    verdicts,
    decisions: { ...learned.decisions, [p.id]: 'bevestigd' },
    asked: { ...learned.asked, [p.id]: now },
    meta: { ...learned.meta, [p.id]: { name: p.name, artist: p.artist } },
  };
}

/** "Toch leuk" weer wissen. */
export function unapproveSong(learned: Learned, key: string): Learned {
  const songOk = { ...(learned.songOk ?? {}) };
  delete songOk[key];
  return { ...learned, songOk };
}

export function unapproveArtist(learned: Learned, key: string): Learned {
  const artistOk = { ...(learned.artistOk ?? {}) };
  delete artistOk[key];
  return { ...learned, artistOk };
}

/** Kort bericht op het startscherm bij iets nieuws dat weg is of pauze krijgt. Hooguit één per dag, nooit een vraag. */
export function latestNotice(learned: Learned, now: number): Verdict | null {
  const seen = learned.noticeSeenAt ?? 0;
  if (seen && now - seen < 20 * 3600 * 1000) return null;
  const fresh = Object.values(learned.verdicts ?? {})
    .filter((v) => v.since > seen && now - v.since < 3 * DAY && now < v.until)
    .sort((a, b) => b.since - a.since);
  return fresh[0] ?? null;
}

/** Zijn de oordelen veranderd? (om onnodig opslaan te voorkomen) */
export function sameVerdicts(a: Record<string, Verdict> | undefined, b: Record<string, Verdict> | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a![k];
    const y = b?.[k];
    if (!y || x.since !== y.since || x.until !== y.until || x.level !== y.level || x.round !== y.round) return false;
  }
  return true;
}
