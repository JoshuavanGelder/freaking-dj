process.env.TZ = 'UTC'; // dagen tellen in lokale tijd: vastzetten voor de tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_LEARNED, computeSignals, heardRecentlyFor, ingest, notNowActive, notNowGroups, patternFor, removeNotNow, tagPlays, type RawEvent } from './learning.ts';
import { PATTERN, approvePattern, artistKey, countKey, latestNotice, liveFactor } from './patterns.ts';
import type { Learned, Play, Signals, Verdict } from './types.ts';

const T0 = Date.parse('2026-09-28T10:00:00Z');
const NOW = T0 + 3600_000;
const MIN = 60_000;

function meta(t: number, id: string, length = 200_000, name = id, artist = 'Artiest'): RawEvent {
  return { t, type: 'meta', id, name, artist, length };
}
function state(t: number, playing: boolean, pos: number): RawEvent {
  return { t, type: 'state', playing, pos };
}

test('ingest: helemaal afgeluisterd en geskipt', () => {
  const ev = [
    meta(T0, 'a'),
    state(T0 + 10, true, 0),
    meta(T0 + 200_500, 'b'), // a klaar
    state(T0 + 200_600, true, 0),
    meta(T0 + 205_000, 'c'), // b na ~4,4 s geskipt
  ];
  const r = ingest(null, ev);
  assert.equal(r.plays.length, 2);
  assert.equal(r.plays[0].outcome, 'full');
  assert.equal(r.plays[1].outcome, 'skip');
  assert.ok(r.plays[1].listenedMs < 5000);
  assert.equal(r.open?.id, 'c');
});

test('ingest: dubbele meldingen negeren, pauze telt niet mee', () => {
  const ev = [
    meta(T0, 'a'),
    meta(T0 + 500, 'a'), // dubbel
    state(T0 + 60_000, false, 60_000), // pauze na 60 s
    state(T0 + 600_000, true, 60_000), // 9 min later verder
    meta(T0 + 610_000, 'b'), // na 70 s geskipt
  ];
  const r = ingest(null, ev);
  assert.equal(r.plays.length, 1);
  assert.equal(r.plays[0].outcome, 'skip');
  assert.ok(Math.abs(r.plays[0].listenedMs - 70_000) < 1000);
});

test('ingest: doorlopen tussen twee batches', () => {
  const a = ingest(null, [meta(T0, 'a'), state(T0 + 5, true, 0)]);
  const b = ingest(a.open, [meta(T0 + 199_000, 'b')]);
  assert.equal(b.plays[0].outcome, 'full');
});

test('ingest: repeat van hetzelfde nummer telt twee keer', () => {
  const r = ingest(null, [meta(T0, 'ord', 180_000), meta(T0 + 180_500, 'ord', 180_000), meta(T0 + 361_000, 'x')]);
  assert.equal(r.plays.filter((p) => p.id === 'ord' && p.outcome === 'full').length, 2);
});

function play(id: string, start: number, outcome: 'full' | 'skip', listenedMs = outcome === 'full' ? 200_000 : 5000, extra: Partial<Play> = {}): Play {
  return { id, name: id, artist: `Artiest ${id}`, lengthMs: 200_000, start, listenedMs, outcome, ...extra };
}
function learned(plays: Play[], over: Partial<Learned> = {}): Learned {
  return { ...EMPTY_LEARNED, plays, ...over };
}

test('doorskippen: skips op rij zijn neutraal en het nummer waar je uitkomt is geen wens', () => {
  const plays = [
    play('p1', T0, 'full'),
    play('s1', T0 + 4 * MIN, 'skip', 3000),
    play('s2', T0 + 4 * MIN + 5000, 'skip', 2000),
    play('goal', T0 + 4 * MIN + 8000, 'full'),
  ];
  const s = computeSignals(learned(plays), { known: new Set(), now: NOW });
  assert.equal('jumpTargets' in s, false, 'waar je naartoe skipte bestaat niet meer');
  assert.equal(s.patterns.length, 0, 'geskipte nummers in een reeks zijn neutraal');
});

test('doorskippen: een reeks skips is ook neutraal als je daarna niets helemaal afluistert', () => {
  const plays = [play('p1', T0, 'full'), play('s1', T0 + 4 * MIN, 'skip', 3000), play('s2', T0 + 4 * MIN + 5000, 'skip', 2000)];
  const s = computeSignals(learned(plays), { known: new Set(['p1']), now: NOW });
  assert.equal(s.patterns.length, 0);
});

test('geen vragen meer: suspicions bestaat niet', () => {
  const s = computeSignals(learned([]), { known: new Set(), now: NOW });
  assert.equal('suspicions' in s, false);
});

test('één snelle skip van een bekend nummer maakt het niet "niet leuk": alleen geen zin in', () => {
  const plays = [play('p1', T0, 'full'), play('fav', T0 + 4 * MIN, 'skip', 3000, { vibe: 'coding' }), play('p2', T0 + 5 * MIN, 'full')];
  const s = computeSignals(learned(plays), { known: new Set(['p1', 'p2', 'fav']), now: NOW });
  assert.equal(s.patterns.length, 0);
  assert.equal(s.notNow.fav?.[0].vibe, 'coding');
});

test('nieuw nummer 1x snel geskipt: minder (niet opnieuw voorstellen), niet weg', () => {
  const plays = [play('p1', T0, 'full'), play('fire', T0 + 4 * MIN, 'skip', 5000, { name: 'Firestone' }), play('p2', T0 + 4 * MIN + 5000, 'full')];
  const s = computeSignals(learned(plays), { known: new Set(['p1', 'p2']), now: NOW });
  assert.equal(s.patterns.length, 1);
  assert.equal(s.patterns[0].level, 'minder');
  assert.equal(s.patterns[0].isNew, true);
  assert.match(s.patterns[0].reason, /nieuw, 1× geskipt/);
  assert.equal(s.notNow.fire, undefined, 'nieuw nummer: geen "geen zin in"');
});

const DAY = 86400000;
/** Elke dag om 10:00: iets afluisteren, het nummer skippen, iets afluisteren (dus een losse skip, geen reeks). */
function daily(id: string, days: number[], extra: Partial<Play> = {}, listened = 5000): Play[] {
  return days.flatMap((d) => [
    play(`f${d}a${id}`, T0 + d * DAY, 'full', 200_000, { vibe: extra.vibe }),
    play(id, T0 + d * DAY + 4 * MIN, 'skip', listened, extra),
    play(`f${d}b${id}`, T0 + d * DAY + 5 * MIN, 'full', 200_000, { vibe: extra.vibe }),
  ]);
}
const find = (s: Signals, id: string) => s.patterns.find((p) => p.kind === 'song' && p.id === id);

test('bekend nummer steeds snel geskipt: 2x minder, 4x over 3+ dagen weg (buiten de gym)', () => {
  const known = new Set(['meh']);
  assert.equal(find(computeSignals(learned(daily('meh', [0, 1])), { known, now: T0 + 2 * DAY }), 'meh')?.level, 'minder');
  assert.equal(find(computeSignals(learned(daily('meh', [0, 1, 2])), { known, now: T0 + 3 * DAY }), 'meh')?.level, 'minder');
  const four = computeSignals(learned(daily('meh', [0, 1, 2, 3])), { known, now: T0 + 4 * DAY });
  const p = find(four, 'meh');
  assert.equal(p?.level, 'weg');
  assert.equal(p?.vibe, 'standaard', 'alleen buiten de gym geskipt: geldt alleen daar');
  assert.match(p!.reason, /4× geskipt op 4 dagen/);
  const v = Object.values(four.verdicts ?? {})[0];
  assert.equal(v.level, 'weg');
  assert.equal(v.until - v.since, PATTERN.goneWeeks * 7 * DAY, 'vastgelegd voor 8 weken');
});

test('weg pas als het over 3+ dagen gebeurt', () => {
  // 4 snelle skips, steeds ruim 12 uur uit elkaar, maar op 2 dagen.
  const at = [0.5, 13, 24.5, 37].map((h) => Date.UTC(2026, 8, 28, 0, 0) + h * 3600_000);
  const plays = at.flatMap((t, i) => [play(`a${i}`, t, 'full'), play('meh', t + 4 * MIN, 'skip', 3000), play(`b${i}`, t + 5 * MIN, 'full')]);
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: at[3] + DAY });
  assert.equal(find(s, 'meh')?.level, 'minder');
});

test('luisterduur: halverwege skippen telt half, na de helft telt niet (en zet de teller ook niet op 0)', () => {
  const known = new Set(['meh']);
  // 4 dagen geskipt na 40 s (van 200 s): samen 2 -> minder, niet weg.
  assert.equal(find(computeSignals(learned(daily('meh', [0, 1, 2, 3], {}, 40_000)), { known, now: T0 + 4 * DAY }), 'meh')?.level, 'minder');
  // Alleen late skips (na 2 minuten): niets, ook niet bij een nieuw nummer.
  assert.equal(computeSignals(learned(daily('late', [0, 1, 2, 3], {}, 120_000)), { known: new Set(['late']), now: T0 + 4 * DAY }).patterns.length, 0);
  assert.equal(computeSignals(learned(daily('nw', [0], {}, 120_000)), { known: new Set(), now: T0 + DAY }).patterns.length, 0);
  // Een late skip tussendoor zet de teller niet op 0.
  const mixed = [...daily('meh', [0, 1]), ...daily('meh', [2], {}, 150_000), ...daily('meh', [3, 4])];
  assert.equal(find(computeSignals(learned(mixed), { known, now: T0 + 5 * DAY }), 'meh')?.level, 'weg');
});

test('nieuw nummer in 2 sessies snel geskipt: weg', () => {
  const s = computeSignals(learned(daily('nw', [0, 1], { fromPlanNew: true })), { known: new Set(['nw']), now: T0 + 2 * DAY });
  const p = find(s, 'nw');
  assert.equal(p?.level, 'weg');
  assert.equal(p?.isNew, true);
});

test('helemaal afluisteren zet de teller op 0', () => {
  const plays = [...daily('meh', [0, 1, 2]), play('meh', T0 + 2 * DAY + 20 * MIN, 'full'), ...daily('meh', [3])];
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: T0 + 4 * DAY });
  assert.equal(find(s, 'meh'), undefined, 'na afluisteren maar 1 skip: alleen geen zin in');
});

test('hetzelfde nummer telt hooguit één keer per halve dag', () => {
  const plays = [0, 1, 2, 3].flatMap((h) => [
    play(`a${h}`, T0 + h * 3 * 3600_000, 'full'),
    play('meh', T0 + h * 3 * 3600_000 + 4 * MIN, 'skip', 3000),
    play(`b${h}`, T0 + h * 3 * 3600_000 + 5 * MIN, 'full'),
  ]);
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: T0 + DAY });
  assert.equal(find(s, 'meh'), undefined);
});

test('minder vervalt na 30 dagen zonder nieuwe skip', () => {
  const s = computeSignals(learned(daily('meh', [0, 1])), { known: new Set(['meh']), now: T0 + 33 * DAY });
  assert.equal(find(s, 'meh'), undefined);
});

test('lastig geval 1: alleen in de gym geskipt, in Standaard uitgeluisterd -> weg in de gym, niet daarbuiten', () => {
  const plays = [0, 1, 2, 3].flatMap((d) => [
    ...daily('ballad', [d], { vibe: 'Legday' }),
    play('ballad', T0 + d * DAY + 6 * 3600_000, 'full', 200_000, { vibe: 'Standaard' }), // 's middags thuis helemaal geluisterd
  ]);
  const s = computeSignals(learned(plays), { known: new Set(['ballad']), now: T0 + 4 * DAY });
  const p = find(s, 'ballad');
  assert.equal(p?.level, 'weg');
  assert.equal(p?.vibe, 'gym');
  const t = { id: 'ballad', name: 'ballad', artists: ['Artiest ballad'] };
  assert.equal(patternFor(s, t, 'Gym')?.level, 'weg');
  assert.equal(patternFor(s, t, 'Standaard'), null);
  assert.equal(patternFor(s, t, 'coding'), null);
});

test('lastig geval 2: favoriet die je vaak hoorde en nu steeds skipt -> 30 dagen pauze, niet "niet leuk"', () => {
  const heard = Array.from({ length: 10 }, (_, d) => play('fav', T0 + d * DAY, 'full'));
  const plays = [...heard, ...daily('fav', [10, 11, 12, 13])];
  const s = computeSignals(learned(plays), { known: new Set(['fav']), now: T0 + 14 * DAY });
  const p = find(s, 'fav');
  assert.equal(p?.level, 'pauze');
  assert.equal(p?.vibe, null, 'verzadiging geldt overal');
  assert.equal(Math.round(((p!.until ?? 0) - p!.last) / DAY), PATTERN.pauseDays);
});

test('lastig geval 3: alleen late skips -> niets', () => {
  const s = computeSignals(learned(daily('x', [0, 1, 2, 3, 4], {}, 130_000)), { known: new Set(['x']), now: T0 + 5 * DAY });
  assert.equal(s.patterns.length, 0);
});

/** Een reeks: twee skips direct na elkaar, tussen twee volledige nummers. */
function run(a: string, b: string, t: number, artist: string): Play[] {
  return [
    play(`r${t}x`, t, 'full'),
    play(a, t + 4 * MIN, 'skip', 3000, { artist }),
    play(b, t + 4 * MIN + 4000, 'skip', 3000),
    play(`r${t}y`, t + 5 * MIN, 'full'),
  ];
}

test('lastig geval 4: artiest die vooral in reeksen wordt weggedrukt -> van minder naar weg', () => {
  const k = (id: string, d: number) => daily(id, [d], { artist: 'Kygo' });
  const base = [...k('k1', 0), ...k('k2', 1)];
  const known = new Set(['k1', 'k2', 'k3', 'k4']);
  const a = (s: Signals) => s.patterns.find((p) => p.kind === 'artist');
  assert.equal(a(computeSignals(learned(base), { known, now: T0 + 2 * DAY }))?.level, 'minder');
  const runs = [...run('k3', 'o1', T0 + 2 * DAY, 'Kygo'), ...run('k4', 'o2', T0 + 3 * DAY, 'Kygo')];
  const s = computeSignals(learned([...base, ...runs]), { known, now: T0 + 4 * DAY });
  assert.equal(a(s)?.level, 'weg', 'reeks-skips tellen half zodra de artiest op minder staat');
  // Zonder eerdere losse skips blijven reeksen neutraal.
  assert.equal(a(computeSignals(learned(runs), { known, now: T0 + 4 * DAY })), undefined);
});

test('overal pas als het in 2+ groepen weg is', () => {
  const gym = daily('song', [0, 2, 4, 6], { vibe: 'Gym' });
  const std = daily('song', [1, 3, 5, 7], { vibe: 'Standaard' });
  const s = computeSignals(learned([...gym, ...std].sort((x, y) => x.start - y.start)), { known: new Set(['song']), now: T0 + 8 * DAY });
  const p = s.patterns.filter((x) => x.kind === 'song' && x.id === 'song');
  assert.equal(p.length, 1);
  assert.equal(p[0].level, 'weg');
  assert.equal(p[0].vibe, null);
});

test('oordeel blijft na opschonen, komt na 8 weken één keer terug als test, en snel skippen = 16 weken weg', () => {
  const four = computeSignals(learned(daily('meh', [0, 1, 2, 3])), { known: new Set(['meh']), now: T0 + 4 * DAY });
  const verdicts = four.verdicts!;
  const v = Object.values(verdicts)[0];
  // Plays opgeschoond, oordeel bewaard: nog steeds weg.
  const kept = computeSignals(learned([], { verdicts }), { known: new Set(), now: T0 + 30 * DAY });
  assert.equal(kept.patterns[0]?.level, 'weg');
  // Na 8 weken: test (minder, niet vooraan).
  const after = v.until + DAY;
  const test1 = computeSignals(learned([], { verdicts }), { known: new Set(['meh']), now: after });
  assert.equal(test1.patterns.length, 0, 'zonder plays geen test-patroon meer nodig');
  const withOld = computeSignals(learned(daily('meh', [0, 1, 2, 3]), { verdicts }), { known: new Set(['meh']), now: after });
  assert.equal(find(withOld, 'meh')?.phase, 'test');
  assert.equal(find(withOld, 'meh')?.level, 'minder');
  // Test mislukt: snel geskipt -> weer weg, nu 16 weken.
  const failDay = Math.ceil((after - T0) / DAY);
  const failed = computeSignals(learned([...daily('meh', [0, 1, 2, 3]), ...daily('meh', [failDay])], { verdicts }), { known: new Set(['meh']), now: T0 + failDay * DAY + DAY });
  const nv = Object.values(failed.verdicts!)[0] as Verdict;
  assert.equal(find(failed, 'meh')?.level, 'weg');
  assert.equal(nv.round, 2);
  assert.equal(nv.until - nv.since, PATTERN.regoneWeeks * 7 * DAY);
  // Test geslaagd: helemaal afgeluisterd -> oordeel weg, niets meer.
  const passed = computeSignals(learned([...daily('meh', [0, 1, 2, 3]), play('meh', T0 + failDay * DAY, 'full')], { verdicts }), { known: new Set(['meh']), now: T0 + failDay * DAY + DAY });
  assert.equal(find(passed, 'meh'), undefined);
  assert.equal(Object.keys(passed.verdicts!).length, 0);
});

test('toch leuk: skips van daarvoor tellen niet, oordeel weg, daarna opnieuw', () => {
  const plays = daily('meh', [0, 1, 2, 3]);
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: T0 + 4 * DAY });
  const p = find(s, 'meh')!;
  const ok = approvePattern(learned(plays, { verdicts: s.verdicts }), p, T0 + 4 * DAY);
  assert.equal(computeSignals(ok, { known: new Set(['meh']), now: T0 + 4 * DAY + MIN }).patterns.length, 0);
  const later = { ...ok, plays: [...plays, ...daily('meh', [5, 6])] };
  assert.equal(find(computeSignals(later, { known: new Set(['meh']), now: T0 + 7 * DAY }), 'meh')?.level, 'minder');
  // Oud antwoord per track-id werkt ook nog.
  const legacy = learned(plays, { decisions: { meh: 'afgewezen' }, asked: { meh: T0 + 3 * DAY + 10 * MIN } });
  assert.equal(computeSignals(legacy, { known: new Set(['meh']), now: T0 + 4 * DAY }).patterns.length, 0);
  // Nooit meer: geen patroon, wel in disliked.
  const never = computeSignals(learned(plays, { decisions: { meh: 'bevestigd' } }), { known: new Set(['meh']), now: T0 + 4 * DAY });
  assert.equal(never.patterns.length, 0);
  assert.deepEqual(never.disliked, ['meh']);
});

test('artiest: steeds verschillende nummers geskipt -> eerst minder, dan (over 3 dagen) weg', () => {
  const k = (id: string, d: number) => daily(id, [d], { artist: 'Kygo' });
  const known = new Set(['k1', 'k2', 'k3']);
  const a2 = computeSignals(learned([...k('k1', 0), ...k('k2', 1)]), { known, now: T0 + 2 * DAY }).patterns.find((p) => p.kind === 'artist');
  assert.equal(a2?.level, 'minder');
  assert.equal(a2?.name, 'Kygo');
  const three = computeSignals(learned([...k('k1', 0), ...k('k2', 1), ...k('k3', 2)]), { known, now: T0 + 3 * DAY });
  const a3 = three.patterns.find((p) => p.kind === 'artist');
  assert.equal(a3?.level, 'weg');
  assert.equal(a3?.songs, 3);
  assert.match(a3!.reason, /3 verschillende nummers/);
  assert.ok(patternFor(three, { id: 'k9', name: 'Nieuw', artists: ['Kygo', 'Ellie Goulding'] }, 'coding'), 'ook een ander nummer van Kygo');
  assert.equal(patternFor(three, { id: 'e1', name: 'Love Me Like You Do', artists: ['Ellie Goulding', 'Kygo'] }, 'coding'), null, 'als gast telt Kygo niet');
  // In één sessie telt niet als patroon.
  const one = [play('a', T0, 'full'), play('k1', T0 + MIN, 'skip', 3000, { artist: 'Kygo' }), play('b', T0 + 2 * MIN, 'full'),
    play('k2', T0 + 6 * MIN, 'skip', 3000, { artist: 'Kygo' }), play('c', T0 + 7 * MIN, 'full'),
    play('k3', T0 + 11 * MIN, 'skip', 3000, { artist: 'Kygo' }), play('d', T0 + 12 * MIN, 'full')];
  assert.equal(computeSignals(learned(one), { known, now: NOW }).patterns.filter((p) => p.kind === 'artist').length, 0);
});

test('artiest: iets van hem afluisteren zet de teller op 0, toch leuk ook', () => {
  const k = (id: string, d: number) => daily(id, [d], { artist: 'Kygo' });
  const known = new Set(['k1', 'k2', 'k3']);
  const plays = [...k('k1', 0), ...k('k2', 1), play('k0', T0 + DAY + 30 * MIN, 'full', 200_000, { artist: 'Kygo' }), ...k('k3', 2)];
  assert.equal(computeSignals(learned(plays), { known, now: T0 + 3 * DAY }).patterns.filter((p) => p.kind === 'artist').length, 0);
  const all = [...k('k1', 0), ...k('k2', 1), ...k('k3', 2)];
  const ok = approvePattern(learned(all), { kind: 'artist', key: 'kygo', name: 'Kygo', artist: 'Kygo' }, T0 + 2 * DAY + 10 * MIN);
  assert.equal(computeSignals(ok, { known, now: T0 + 3 * DAY }).patterns.filter((p) => p.kind === 'artist').length, 0);
  // Op de blocklist: geen patroon meer nodig.
  assert.equal(computeSignals(learned(all), { known, now: T0 + 3 * DAY, blockedArtists: ['Kygo'] }).patterns.filter((p) => p.kind === 'artist').length, 0);
});

test('versies: Remastered en Radio Edit tellen samen, live en remix apart; gast-artiest telt niet', () => {
  assert.equal(countKey('Firestone - 2014 Remaster', 'Kygo'), countKey('Firestone', 'Kygo'));
  assert.equal(countKey('Firestone (Radio Edit)', 'Kygo, Conrad Sewell'), countKey('Firestone', 'Kygo'));
  assert.equal(countKey('Firestone (feat. Conrad Sewell)', 'Kygo'), countKey('Firestone', 'Kygo'));
  assert.notEqual(countKey('Firestone - Live', 'Kygo'), countKey('Firestone', 'Kygo'));
  assert.notEqual(countKey('Firestone (Remix)', 'Kygo'), countKey('Firestone', 'Kygo'));
  assert.notEqual(countKey('Firestone (Live at Ziggo Dome 2019)', 'Kygo'), countKey('Firestone', 'Kygo'));
  assert.equal(artistKey('Kygo, Ellie Goulding'), 'kygo');
  // Twee uitgaven van hetzelfde nummer: samen 4 snelle skips -> weg.
  const plays = [...daily('v1', [0, 1], { name: 'Song', artist: 'X' }), ...daily('v2', [2, 3], { name: 'Song - Remastered 2011', artist: 'X' })];
  const s = computeSignals(learned(plays), { known: new Set(['v1', 'v2']), now: T0 + 4 * DAY });
  assert.equal(s.patterns.find((p) => p.kind === 'song')?.level, 'weg');
});

test('stijl-hint: 3 artiesten van één stijl vaak geskipt (en weinig afgeluisterd)', () => {
  const sk = (id: string, d: number, artist: string) => daily(id, [d], { artist, style: 'Country', vibe: 'Gym' });
  const plays = [...sk('c1', 0, 'A'), ...sk('c2', 1, 'B'), ...sk('c3', 2, 'C')].map((p) => (p.outcome === 'full' ? { ...p, style: 'Pop' } : p));
  const s = computeSignals(learned(plays), { known: new Set(['c1', 'c2', 'c3']), now: T0 + 3 * DAY });
  assert.deepEqual(s.styles?.map((h) => [h.group, h.style]), [['gym', 'Country']]);
  // Veel Country helemaal afgeluisterd: geen hint.
  const liked = Array.from({ length: 6 }, (_, i) => play(`cf${i}`, T0 + 3 * DAY + i * 5 * MIN, 'full', 200_000, { style: 'Country', vibe: 'Gym' }));
  assert.equal(computeSignals(learned([...plays, ...liked]), { known: new Set(['c1', 'c2', 'c3']), now: T0 + 3 * DAY + DAY }).styles?.length, 0);
});

test('Live DJ: skip je daar duidelijk vaker, dan tellen die skips iets minder', () => {
  const mk = (n: number, skipEvery: number, live: boolean) =>
    Array.from({ length: n }, (_, i) => play(`${live ? 'l' : 'q'}${i}`, T0 + i * 5 * MIN + (live ? 0 : 3 * MIN), i % skipEvery === 0 ? 'skip' : 'full', undefined, { vibe: 'Standaard', live }));
  assert.equal(liveFactor([...mk(50, 2, true), ...mk(50, 5, false)], T0 + DAY), PATTERN.liveFactor);
  assert.equal(liveFactor([...mk(50, 5, true), ...mk(50, 5, false)], T0 + DAY), 1);
  assert.equal(liveFactor([...mk(10, 2, true), ...mk(50, 5, false)], T0 + DAY), 1, 'te weinig Live DJ-plays om iets te zeggen');
});

test('melding "Nieuw geleerd": nieuwste oordeel, hooguit één per dag', () => {
  const v = (since: number, name: string): Verdict => ({ kind: 'song', key: name, group: 'standaard', level: 'weg', name, artist: 'X', since, until: since + 56 * DAY, round: 1, reason: 'r' });
  const verdicts = { a: v(NOW - DAY, 'A'), b: v(NOW - 2 * 3600_000, 'B') };
  assert.equal(latestNotice(learned([], { verdicts }), NOW)?.name, 'B');
  assert.equal(latestNotice(learned([], { verdicts, noticeSeenAt: NOW - 3600_000 }), NOW), null, 'net weggetikt');
  assert.equal(latestNotice(learned([], { verdicts, noticeSeenAt: NOW - 3600_000 }), NOW + DAY), null, 'al gezien');
  assert.equal(latestNotice(learned([], { verdicts: { a: v(NOW - 5 * DAY, 'A') } }), NOW), null, 'te oud');
});

test('geen zin in: bekende favoriet los geskipt, per vibe', () => {
  const plays = [
    play('p1', T0, 'full'),
    play('cs', T0 + 4 * MIN, 'skip', 40_000, { vibe: 'coding' }),
    play('p2', T0 + 5 * MIN, 'full'),
  ];
  const s = computeSignals(learned(plays), { known: new Set(['cs']), now: NOW });
  assert.equal(s.notNow.cs?.[0].vibe, 'coding');
  assert.equal(s.patterns.length, 0);
});

test('te vaak gedraaid: 2 weken rust, ook via Spotify-geschiedenis', () => {
  const plays = Array.from({ length: 5 }, (_, i) => play('ord', T0 + i * 4 * MIN, 'full'));
  const s = computeSignals(learned(plays), { known: new Set(), now: NOW });
  assert.ok(s.resting.ord > NOW + 13 * 86400000);
  const s2 = computeSignals(learned([]), {
    known: new Set(),
    now: NOW,
    recentPlays: Array.from({ length: 6 }, (_, i) => ({ id: 'x', at: NOW - i * 3600_000 })),
  });
  assert.ok(s2.resting.x > NOW);
  const lifted = computeSignals(learned(plays, { unrest: { ord: NOW - 1 } }), { known: new Set(), now: NOW });
  assert.equal(lifted.resting.ord, undefined, 'rust opgeheven');
  const s3 = computeSignals(learned(plays.slice(0, 3)), { known: new Set(), now: NOW });
  assert.equal(s3.resting.ord, undefined);
});

test('tagPlays koppelt aan de juiste wachtrij', () => {
  const tagged = tagPlays([play('a', T0 + MIN, 'skip')], [
    { vibe: 'gym', createdAt: T0 - 10 * 3600_000, ids: ['a'], newIds: [] },
    { vibe: 'coding', createdAt: T0, ids: ['a'], newIds: ['a'] },
  ]);
  assert.equal(tagged[0].vibe, 'coding');
  assert.equal(tagged[0].fromPlanNew, true);
});

// ---------- geen gym-nummer ----------
// Situatie van 25-11: in de gym druk je alles weg wat geen banger is, vaak een paar op rij. Die skips zeggen hier juist wat
// geen gym-nummer is (Paralyzed van NF kwam steeds terug omdat een reeks skips neutraal was).

test('gym: een reeks skips telt wel, nummers komen niet meer in de gym; bij Standaard blijft een reeks neutraal', () => {
  const g = { vibe: 'Gym' };
  const plays = [
    play('slim', T0, 'full', 200_000, g),
    play('paralyzed', T0 + 4 * MIN, 'skip', 2000, g),
    play('hate', T0 + 4 * MIN + 3000, 'skip', 1000, g),
    play('kick', T0 + 4 * MIN + 5000, 'full', 200_000, g),
    play('a', T0 + 8 * MIN, 'skip', 2000, { vibe: 'Standaard' }),
    play('b', T0 + 8 * MIN + 3000, 'skip', 1000, { vibe: 'Standaard' }),
    play('c', T0 + 8 * MIN + 5000, 'full', 200_000, { vibe: 'Standaard' }),
  ];
  const s = computeSignals(learned(plays), { known: new Set(['paralyzed', 'hate', 'a', 'b']), now: NOW });
  assert.equal(s.notNow.paralyzed?.[0].gym, true);
  assert.equal(s.notNow.paralyzed?.[0].note, 'in de gym geskipt');
  assert.equal(s.notNow.hate?.[0].gym, true);
  assert.equal(s.notNow.a, undefined, 'Standaard: reeks blijft neutraal');
  assert.equal(s.patterns.length, 0, 'geen "niet leuk": alleen niet voor de gym');
});

test('gym: ook een nieuw nummer dat je in de gym wegdrukt komt daar niet meer', () => {
  const plays = [play('p1', T0, 'full', 200_000, { vibe: 'Legday' }), play('thunder', T0 + 4 * MIN, 'skip', 1000, { vibe: 'Legday', fromPlanNew: true })];
  const s = computeSignals(learned(plays), { known: new Set(), now: NOW });
  assert.equal(s.notNow.thunder?.[0].gym, true, 'Legday hoort bij Gym');
});

test('gym: bewezen nummer valt pas af als je het vaker skipt dan afluistert', () => {
  const g = { vibe: 'Gym' };
  const day = (d: number) => T0 - d * 86400000;
  const once = [play('ly', day(10), 'full', 200_000, g), play('x', day(1), 'full', 200_000, g), play('ly', day(1) + 4 * MIN, 'skip', 12_000, g)];
  assert.ok(!computeSignals(learned(once), { known: new Set(['ly']), now: NOW }).notNow.ly?.some((e) => e.gym), '1 tegen 1: blijft');
  const twice = [...once, play('y', day(0) - 3 * 86400000, 'full', 200_000, g), play('ly', T0, 'skip', 3000, g)];
  const s = computeSignals(learned(twice), { known: new Set(['ly']), now: NOW });
  const e = s.notNow.ly?.find((x) => x.gym);
  assert.ok(e, '2 skips tegen 1 keer afgeluisterd');
  assert.equal(e!.note, '2× in de gym geskipt');
});

test('gym: late skip en herhaling tellen niet', () => {
  const g = { vibe: 'Gym' };
  const plays = [
    play('p1', T0, 'full', 200_000, g),
    play('burn', T0 + 4 * MIN, 'skip', 160_000, g), // na 160 van de 200 s: telt niet
    play('p2', T0 + 8 * MIN, 'full', 200_000, g),
    play('ly', T0 + 12 * MIN, 'full', 200_000, { vibe: 'Standaard' }), // vanmiddag al gehoord
    play('ly', T0 + 30 * MIN, 'skip', 3000, g),
  ];
  const s = computeSignals(learned(plays), { known: new Set(['burn', 'ly']), now: NOW });
  assert.ok(!s.notNow.burn?.some((e) => e.gym));
  assert.ok(!s.notNow.ly?.some((e) => e.gym), 'net al gehoord: zegt niets');
});

test('gym: blijft tot 60 dagen staan, zelf wissen werkt, en het staat in Geleerd met uitleg', () => {
  const g = { vibe: 'Gym' };
  const plays = [play('p1', T0, 'full', 200_000, g), play('par', T0 + 4 * MIN, 'skip', 2000, g), play('hm', T0 + 4 * MIN + 3000, 'skip', 2000, g)];
  const s = computeSignals(learned(plays), { known: new Set(), now: NOW });
  const e = s.notNow.par![0];
  assert.ok(notNowActive(e, NOW + 30 * 86400000), 'na een maand nog steeds');
  assert.ok(!notNowActive(e, NOW + 61 * 86400000));
  const groups = notNowGroups(s, NOW);
  const gym = groups.find((x) => x.group === 'gym');
  assert.equal(gym?.lines.length, 2);
  assert.equal(gym?.lines[0].note, 'in de gym geskipt');
  const wiped = removeNotNow(learned(plays), 'par', 'Gym', NOW);
  const s2 = computeSignals(wiped, { known: new Set(), now: NOW });
  assert.equal(s2.notNow.par, undefined, 'zelf gewist');
  const later = NOW + 2 * 86400000;
  const again = computeSignals({ ...wiped, plays: [...plays, play('par', later, 'skip', 2000, g), play('p3', later + MIN, 'full', 200_000, g)] }, { known: new Set(), now: later + 2 * MIN });
  assert.equal(again.notNow.par?.[0].gym, true, 'opnieuw geskipt na wissen: weer weg uit de gym');
});

test('heard today: bij Gym alleen wat je in de gym hoorde, bij Standaard alles', () => {
  const plays = [
    play('bang', NOW - 4 * 3600_000, 'full', 200_000, { vibe: 'Standaard' }),
    play('gymtrack', NOW - 3600_000, 'full', 200_000, { vibe: 'Gym' }),
    play('old', NOW - 13 * 3600_000, 'full', 200_000, { vibe: 'Gym' }),
  ];
  const recent = [{ id: 'pc', at: NOW - 3600_000 }];
  assert.deepEqual([...heardRecentlyFor('Gym', plays, recent, NOW)].sort(), ['gymtrack']);
  assert.deepEqual([...heardRecentlyFor('Standaard', plays, recent, NOW)].sort(), ['bang', 'gymtrack', 'pc']);
});
