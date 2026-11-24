import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_LEARNED, approveArtist, computeSignals, dislikedKeys, ingest, patternFor, tagPlays, type RawEvent } from './learning.ts';
import type { Learned, Play } from './types.ts';

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
/** Elke dag: iets afluisteren, het nummer skippen, iets afluisteren (dus losse skip, geen reeks). */
function daily(id: string, days: number[], extra: Partial<Play> = {}): Play[] {
  return days.flatMap((d) => [
    play(`f${d}a`, T0 + d * DAY, 'full'),
    play(id, T0 + d * DAY + 4 * MIN, 'skip', 40_000, extra),
    play(`f${d}b`, T0 + d * DAY + 5 * MIN, 'full'),
  ]);
}

test('bekend nummer steeds geskipt: 2x minder, 4x weg', () => {
  const known = new Set(['meh']);
  const two = computeSignals(learned(daily('meh', [0, 1])), { known, now: T0 + 2 * DAY });
  assert.equal(two.patterns.find((p) => p.key === 'meh')?.level, 'minder');
  const three = computeSignals(learned(daily('meh', [0, 1, 2])), { known, now: T0 + 3 * DAY });
  assert.equal(three.patterns.find((p) => p.key === 'meh')?.level, 'minder');
  const four = computeSignals(learned(daily('meh', [0, 1, 2, 3])), { known, now: T0 + 4 * DAY });
  const p = four.patterns.find((x) => x.key === 'meh');
  assert.equal(p?.level, 'weg');
  assert.equal(p?.vibe, null);
  assert.match(p!.reason, /4× geskipt sinds/);
  assert.ok(dislikedKeys(four, learned([])).has('meh|artiest meh'), 'ook andere versies');
});

test('nieuw nummer in 2 sessies geskipt: weg', () => {
  const s = computeSignals(learned(daily('nw', [0, 1], { fromPlanNew: true })), { known: new Set(['nw']), now: T0 + 2 * DAY });
  const p = s.patterns.find((x) => x.key === 'nw');
  assert.equal(p?.level, 'weg');
  assert.equal(p?.isNew, true);
});

test('helemaal afluisteren zet de teller op 0', () => {
  const plays = [...daily('meh', [0, 1, 2]), play('meh', T0 + 2 * DAY + 20 * MIN, 'full'), ...daily('meh', [3])];
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: T0 + 4 * DAY });
  assert.equal(s.patterns.find((x) => x.key === 'meh'), undefined, 'na afluisteren maar 1 skip: alleen geen zin in');
});

test('hetzelfde nummer telt hooguit één keer per halve dag', () => {
  // 4 losse skips op één dag (in verschillende sessies): telt als 1.
  const plays = [0, 1, 2, 3].flatMap((h) => [
    play(`a${h}`, T0 + h * 3 * 3600_000, 'full'),
    play('meh', T0 + h * 3 * 3600_000 + 4 * MIN, 'skip', 40_000),
    play(`b${h}`, T0 + h * 3 * 3600_000 + 5 * MIN, 'full'),
  ]);
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: T0 + DAY });
  assert.equal(s.patterns.find((x) => x.key === 'meh'), undefined);
});

test('alleen in de gym steeds geskipt: alleen weg bij Gym', () => {
  const s = computeSignals(learned(daily('ballad', [0, 1, 2, 3], { vibe: 'Legday' })), { known: new Set(['ballad']), now: T0 + 4 * DAY });
  const p = s.patterns.find((x) => x.key === 'ballad');
  assert.equal(p?.level, 'weg');
  assert.equal(p?.vibe, 'gym');
  assert.ok(patternFor(s, { id: 'ballad', artists: ['x'] }, 'Gym'));
  assert.equal(patternFor(s, { id: 'ballad', artists: ['x'] }, 'Standaard'), null);
  // Overal geskipt (ook Standaard): geldt overal.
  const mix = [...daily('b2', [0, 1], { vibe: 'Gym' }), ...daily('b2', [2, 3], { vibe: 'Standaard' })];
  assert.equal(computeSignals(learned(mix), { known: new Set(['b2']), now: T0 + 4 * DAY }).patterns.find((x) => x.key === 'b2')?.vibe, null);
});

test('toch leuk: skips van daarvoor tellen niet, daarna opnieuw', () => {
  const plays = daily('meh', [0, 1, 2, 3]);
  const L = learned(plays, { decisions: { meh: 'afgewezen' }, asked: { meh: T0 + 3 * DAY + 10 * MIN } });
  assert.equal(computeSignals(L, { known: new Set(['meh']), now: T0 + 4 * DAY }).patterns.length, 0);
  const later = learned([...plays, ...daily('meh', [4, 5])], { decisions: { meh: 'afgewezen' }, asked: { meh: T0 + 3 * DAY + 10 * MIN } });
  assert.equal(computeSignals(later, { known: new Set(['meh']), now: T0 + 6 * DAY }).patterns.find((x) => x.key === 'meh')?.level, 'minder');
  // Nooit meer: geen patroon, wel in disliked.
  const never = computeSignals(learned(plays, { decisions: { meh: 'bevestigd' } }), { known: new Set(['meh']), now: T0 + 4 * DAY });
  assert.equal(never.patterns.length, 0);
  assert.deepEqual(never.disliked, ['meh']);
});

test('artiest: steeds verschillende nummers geskipt -> eerst minder, dan weg', () => {
  const k = (id: string, d: number) => daily(id, [d], { artist: 'Kygo' });
  const two = computeSignals(learned([...k('k1', 0), ...k('k2', 1)]), { known: new Set(['k1', 'k2', 'k3']), now: T0 + 2 * DAY });
  const a2 = two.patterns.find((p) => p.kind === 'artist');
  assert.equal(a2?.level, 'minder');
  assert.equal(a2?.name, 'Kygo');
  const three = computeSignals(learned([...k('k1', 0), ...k('k2', 1), ...k('k3', 2)]), { known: new Set(['k1', 'k2', 'k3']), now: T0 + 3 * DAY });
  const a3 = three.patterns.find((p) => p.kind === 'artist');
  assert.equal(a3?.level, 'weg');
  assert.equal(a3?.songs, 3);
  assert.match(a3!.reason, /3 verschillende nummers/);
  assert.ok(patternFor(three, { id: 'k9', artists: ['Kygo', 'Ellie Goulding'] }, 'coding'), 'ook een ander nummer van Kygo');
  // In één sessie telt niet als patroon.
  const one = [play('a', T0, 'full'), play('k1', T0 + MIN, 'skip', 40_000, { artist: 'Kygo' }), play('b', T0 + 2 * MIN, 'full'),
    play('k2', T0 + 6 * MIN, 'skip', 40_000, { artist: 'Kygo' }), play('c', T0 + 7 * MIN, 'full'),
    play('k3', T0 + 11 * MIN, 'skip', 40_000, { artist: 'Kygo' }), play('d', T0 + 12 * MIN, 'full')];
  assert.equal(computeSignals(learned(one), { known: new Set(['k1', 'k2', 'k3']), now: NOW }).patterns.filter((p) => p.kind === 'artist').length, 0);
});

test('artiest: iets van hem afluisteren zet de teller op 0, toch leuk ook', () => {
  const k = (id: string, d: number) => daily(id, [d], { artist: 'Kygo' });
  const plays = [...k('k1', 0), ...k('k2', 1), play('k0', T0 + DAY + 30 * MIN, 'full', 200_000, { artist: 'Kygo' }), ...k('k3', 2)];
  assert.equal(computeSignals(learned(plays), { known: new Set(['k1', 'k2', 'k3']), now: T0 + 3 * DAY }).patterns.filter((p) => p.kind === 'artist').length, 0);
  const all = [...k('k1', 0), ...k('k2', 1), ...k('k3', 2)];
  const ok = approveArtist(learned(all), { key: 'kygo', name: 'Kygo' }, T0 + 2 * DAY + 10 * MIN);
  assert.equal(computeSignals(ok, { known: new Set(['k1', 'k2', 'k3']), now: T0 + 3 * DAY }).patterns.filter((p) => p.kind === 'artist').length, 0);
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
