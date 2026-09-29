import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_LEARNED, computeSignals, ingest, openQuestions, tagPlays, type RawEvent } from './learning.ts';
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
  return { id, name: id, artist: 'X', lengthMs: 200_000, start, listenedMs, outcome, ...extra };
}
function learned(plays: Play[], over: Partial<Learned> = {}): Learned {
  return { ...EMPTY_LEARNED, plays, ...over };
}

test('doorspringen: skips op rij zijn neutraal, doel is favoriet', () => {
  const plays = [
    play('p1', T0, 'full'),
    play('s1', T0 + 4 * MIN, 'skip', 3000),
    play('s2', T0 + 4 * MIN + 5000, 'skip', 2000),
    play('goal', T0 + 4 * MIN + 8000, 'full'),
  ];
  const s = computeSignals(learned(plays), { known: new Set(), now: NOW });
  assert.equal(s.jumpTargets.goal, 1);
  assert.equal(s.suspicions.length, 0, 'geskipte nummers in een reeks zijn neutraal');
});

test('niet leuk: nieuw nummer binnen 30 s geskipt -> vermoeden + vraag', () => {
  const plays = [play('p1', T0, 'full'), play('fire', T0 + 4 * MIN, 'skip', 5000, { name: 'Firestone' }), play('p2', T0 + 4 * MIN + 5000, 'full')];
  const L = learned(plays);
  const s = computeSignals(L, { known: new Set(['p1', 'p2']), now: NOW });
  assert.equal(s.suspicions.length, 1);
  assert.equal(s.suspicions[0].question, 'Firestone binnen 5 s geskipt, vind je die niks?');
  assert.equal(openQuestions(s, L).length, 1);
  // Eén keer vragen.
  assert.equal(openQuestions(s, { ...L, asked: { fire: NOW } }).length, 0);
});

test('niet leuk: vervalt als het nummer later wel helemaal speelt', () => {
  const plays = [play('fire', T0, 'skip', 5000), play('p2', T0 + 5000, 'full'), play('fire', T0 + 20 * MIN, 'full')];
  const s = computeSignals(learned(plays), { known: new Set(), now: NOW });
  assert.equal(s.suspicions.length, 0);
});

test('jouw antwoord gaat voor', () => {
  const plays = [play('fire', T0, 'skip', 5000), play('p2', T0 + 5000, 'full')];
  const ok = computeSignals(learned(plays, { decisions: { fire: 'afgewezen' } }), { known: new Set(), now: NOW });
  assert.equal(ok.suspicions.length, 0);
  assert.deepEqual(ok.disliked, []);
  const bad = computeSignals(learned(plays, { decisions: { fire: 'bevestigd' } }), { known: new Set(), now: NOW });
  assert.deepEqual(bad.disliked, ['fire']);
});

test('geen zin in: bekende favoriet los geskipt, per vibe', () => {
  const plays = [
    play('p1', T0, 'full'),
    play('cs', T0 + 4 * MIN, 'skip', 40_000, { vibe: 'coding' }),
    play('p2', T0 + 5 * MIN, 'full'),
  ];
  const s = computeSignals(learned(plays), { known: new Set(['cs']), now: NOW });
  assert.equal(s.notNow.cs?.[0].vibe, 'coding');
  assert.equal(s.suspicions.length, 0);
});

test('niet leuk: in 3 sessies geskipt', () => {
  const day = 86400000;
  const plays = [0, 1, 2].flatMap((d) => [
    play('p', T0 + d * day, 'full'),
    play('meh', T0 + d * day + 4 * MIN, 'skip', 50_000),
    play('q', T0 + d * day + 5 * MIN, 'full'),
  ]);
  const s = computeSignals(learned(plays), { known: new Set(['meh']), now: T0 + 3 * day });
  assert.equal(s.suspicions[0]?.id, 'meh');
  assert.match(s.suspicions[0].reason, /3 sessies/);
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
