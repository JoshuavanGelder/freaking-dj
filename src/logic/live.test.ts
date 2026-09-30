import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReplan, feedbackForClaude, missingQueued, observe, pickNext, reconcileNative, startLive, takeNext, type LiveState } from './live.ts';
import type { PlanItem, Track } from './types.ts';

const tr = (id: string, artist: string, name = id): Track => ({ id, name, artists: [artist], durationMs: 200_000 });
const it = (id: string, artist: string, style = 'Pop', isNew = false): PlanItem => ({ track: tr(id, artist), style, isNew, energy: 3 });
const T0 = 1_000_000;

function setup(items: PlanItem[], first: string | null = 'a') {
  const all = new Map(items.map((x) => [x.track.id, x]));
  const lookup = (id: string) => {
    const x = all.get(id);
    return x ? { track: x.track, style: x.style, isNew: x.isNew } : null;
  };
  return { s: startLive('p1', 'coding', items, first, T0), lookup };
}

test('eerste eigen nummer begint -> volgende in de wachtrij zetten', () => {
  const { s, lookup } = setup([it('a', 'NF'), it('b', 'Avicii'), it('c', 'AC/DC')]);
  assert.deepEqual(s.upcoming.map((x) => x.track.id), ['b', 'c']);
  // Er speelt nog een oud nummer: niets doen.
  let r = observe(s, { id: 'old', progressMs: 1000, durationMs: 200_000, isPlaying: true, at: T0 + 1000 }, lookup);
  assert.deepEqual(r.actions.filter((a) => a.type === 'queueNext'), []);
  // Ons nummer begint.
  r = observe(r.state, { id: 'a', progressMs: 500, durationMs: 200_000, isPlaying: true, at: T0 + 200_000 }, lookup);
  assert.equal(r.state.queuedId, null);
  assert.ok(r.actions.some((a) => a.type === 'queueNext'));
});

test('skip wordt vastgelegd en de volgende keuze past zich aan', () => {
  const items = [it('a', 'NF', 'Rap'), it('b', 'Kygo', 'EDM', true), it('c', 'Kygo', 'EDM'), it('d', 'Green Day', 'Punk'), it('e', 'Avicii', 'EDM', true), it('f', 'AC/DC', 'Rock')];
  let { s, lookup } = setup(items);
  s = observe(s, { id: 'a', progressMs: 0, durationMs: 200_000, isPlaying: true, at: T0 }, lookup).state;
  // DJ zet b (Kygo, nieuw) in de wachtrij.
  const p1 = pickNext(s, tr('a', 'NF'), () => true)!;
  s = takeNext(s, p1.index, T0).state;
  assert.equal(s.queuedId, 'b');
  // a helemaal gehoord, b begint en wordt na 5 s geskipt.
  s = observe(s, { id: 'a', progressMs: 199_000, durationMs: 200_000, isPlaying: true, at: T0 + 199_000 }, lookup).state;
  s = observe(s, { id: 'b', progressMs: 1000, durationMs: 200_000, isPlaying: true, at: T0 + 200_000 }, lookup).state;
  s = observe(s, { id: 'b', progressMs: 5000, durationMs: 200_000, isPlaying: true, at: T0 + 204_000 }, lookup).state;
  const r = observe(s, { id: 'x-autoplay', progressMs: 100, durationMs: 180_000, isPlaying: true, at: T0 + 205_000 }, lookup);
  assert.equal(r.state.played.at(-1)?.outcome, 'skip');
  assert.equal(r.state.played.at(-2)?.outcome, 'full');
  // Niet nog een Kygo en geen nieuw nummer direct na een geskipt nieuw nummer.
  const p = pickNext(r.state, null, () => true)!;
  const chosen = r.state.upcoming[p.index].track.id;
  assert.equal(chosen, 'd');
  assert.ok(p.why.length > 0);
});

test('twee snelle skips op rij -> Claude laten bijsturen, maar niet steeds opnieuw', () => {
  const items = Array.from({ length: 10 }, (_, i) => it(`t${i}`, `Artist ${i}`));
  let { s, lookup } = setup(items, 't0');
  const play = (id: string, at: number) => (s = observe(s, { id, progressMs: 0, durationMs: 200_000, isPlaying: true, at }, lookup).state);
  play('t0', T0);
  s = { ...s, queuedId: 't1' };
  s = observe(s, { id: 't0', progressMs: 3000, durationMs: 200_000, isPlaying: true, at: T0 + 3000 }, lookup).state;
  play('t1', T0 + 4000);
  s = { ...s, queuedId: 't2' };
  s = observe(s, { id: 't1', progressMs: 4000, durationMs: 200_000, isPlaying: true, at: T0 + 8000 }, lookup).state;
  const r = observe(s, { id: 't2', progressMs: 0, durationMs: 200_000, isPlaying: true, at: T0 + 9000 }, lookup);
  assert.ok(r.actions.some((a) => a.type === 'replan' && a.reason === 'skips'));
  const after = { ...r.state, lastReplanAt: r.state.played.length };
  const r2 = observe(after, { id: 't2', progressMs: 1000, durationMs: 200_000, isPlaying: true, at: T0 + 10_000 }, lookup);
  assert.ok(!r2.actions.some((a) => a.type === 'replan'));
});

test('bijna op -> aanvullen', () => {
  const { s, lookup } = setup([it('a', 'NF'), it('b', 'X'), it('c', 'Y')]);
  const r = observe(s, { id: 'a', progressMs: 0, durationMs: 200_000, isPlaying: true, at: T0 }, lookup);
  assert.ok(r.actions.some((a) => a.type === 'replan' && a.reason === 'aanvullen'));
});

test('niet dezelfde artiest als wat nu speelt', () => {
  const { s } = setup([it('a', 'NF'), it('b', 'NF'), it('c', 'Avicii')], null);
  const p = pickNext(s, tr('z', 'NF'), () => true)!;
  assert.equal(s.upcoming[p.index].track.id, 'c');
});

test('doorspringen: na skips naar een stijl die blijft hangen -> meer van die stijl', () => {
  const items = [it('n1', 'A', 'Rock'), it('n2', 'B', 'Country'), it('n3', 'C', 'Rock')];
  const { s } = setup(items, null);
  const state: LiveState = {
    ...s,
    played: [
      { track: tr('s1', 'X'), style: 'EDM', isNew: false, outcome: 'skip', listenedMs: 3000, at: 1 },
      { track: tr('s2', 'Y'), style: 'EDM', isNew: false, outcome: 'skip', listenedMs: 2000, at: 2 },
      { track: tr('g', 'Z'), style: 'Country', isNew: false, outcome: 'full', listenedMs: 200_000, at: 3 },
    ],
  };
  const p = pickNext(state, null, () => true)!;
  assert.equal(state.upcoming[p.index].track.id, 'n2');
});

test('regels blijven gelden en gespeelde nummers komen niet terug', () => {
  const { s } = setup([it('a', 'Loreen'), it('b', 'NF')], null);
  const p = pickNext(s, null, (t) => t.artists[0] !== 'Loreen')!;
  assert.equal(s.upcoming[p.index].track.id, 'b');
  const re = applyReplan({ ...s, played: [{ track: tr('b', 'NF'), style: 'Rap', isNew: false, outcome: 'full', listenedMs: 1, at: 1 }], queuedId: 'c' }, [it('b', 'NF'), it('c', 'X'), it('d', 'Y')], 'p2', 1, 'bijgestuurd');
  assert.deepEqual(re.upcoming.map((x) => x.track.id), ['d']);
  assert.equal(re.planId, 'p2');
});

test('feedback voor Claude noemt gehoord en geskipt', () => {
  const { s } = setup([], null);
  const f = feedbackForClaude({
    ...s,
    played: [
      { track: tr('a', 'NF', 'Hope'), style: 'Rap', isNew: false, outcome: 'full', listenedMs: 200_000, at: 1 },
      { track: tr('b', 'Kygo', 'Firestone'), style: 'EDM', isNew: true, outcome: 'skip', listenedMs: 5000, at: 2 },
    ],
  });
  assert.match(f, /Helemaal geluisterd: Hope – NF/);
  assert.match(f, /Geskipt: Firestone – Kygo \(EDM, nieuw\) na 5 s/);
});

test('na slapen: geen verkeerde skip, en toch meteen het volgende klaarzetten', () => {
  const { s, lookup } = setup([it('a', 'NF'), it('b', 'X'), it('c', 'Y'), it('d', 'Z'), it('e', 'Q'), it('f', 'R')]);
  let st = observe(s, { id: 'a', progressMs: 1000, durationMs: 200_000, isPlaying: true, at: T0 }, lookup).state;
  st = { ...st, queuedId: 'b' };
  // App sliep 10 minuten; er speelt nu een autoplay-nummer en b is al voorbij.
  const r = observe(st, { id: 'auto', progressMs: 3000, durationMs: 200_000, isPlaying: true, at: T0 + 600_000 }, lookup);
  assert.equal(r.state.played.length, 0, 'a niet als skip tellen');
  assert.ok(r.actions.some((x) => x.type === 'chainBroken'));
  // Na de controle (b staat er niet meer) moet er direct iets klaargezet worden, ook al is "auto" niet van ons.
  const r2 = observe({ ...r.state, queuedId: null }, { id: 'auto', progressMs: 7000, durationMs: 200_000, isPlaying: true, at: T0 + 604_000 }, lookup);
  assert.ok(r2.actions.some((x) => x.type === 'queueNext'));
});

test('reconcileNative: klaargezet nummer en geschiedenis van de dienst overnemen', () => {
  const { s, lookup } = setup([it('a', 'NF'), it('b', 'X'), it('c', 'Y'), it('d', 'Z')]);
  const r = reconcileNative(
    { ...s, queuedId: 'a' },
    { active: true, queuedId: 'c', history: [{ id: 'a', outcome: 'full', listenedMs: 200_000, at: T0 + 200_000 }, { id: 'b', outcome: 'skip', listenedMs: 4000, at: T0 + 204_000 }] },
    lookup,
    T0 + 205_000,
  );
  assert.equal(r.queuedId, 'c');
  assert.deepEqual(r.upcoming.map((x) => x.track.id), ['d']);
  assert.deepEqual(r.played.map((p) => `${p.track.id}:${p.outcome}`), ['a:full', 'b:skip']);
  // Nog een keer: geen dubbelen.
  const again = reconcileNative(r, { active: true, queuedId: 'c', history: [{ id: 'a', outcome: 'full', listenedMs: 200_000, at: T0 + 200_000 }] }, lookup, T0 + 206_000);
  assert.equal(again.played.length, 2);
  // Dienst kon niets klaarzetten: app neemt over.
  assert.equal(reconcileNative(r, { active: true, queuedId: '', history: [] }, lookup, T0 + 207_000).queuedId, null);
});

test('missingQueued: wat wij klaarzetten en uit de wachtrij verdween, moet terug', () => {
  const { s } = setup([it('a', 'NF'), it('b', 'X'), it('c', 'Y')], 'a');
  // Staat er nog in (ook achter oude nummers): niets te doen.
  assert.equal(missingQueued(s, ['old1', 'a'], 'old0'), null);
  // Wachtrij leeggemaakt: het klaargezette nummer moet opnieuw.
  assert.equal(missingQueued(s, [], 'old0'), 'a');
  assert.equal(missingQueued(s, ['old1', 'old2'], null), 'a');
  // Speelt al: niets kwijt.
  assert.equal(missingQueued(s, [], 'a'), null);
  // Niets klaargezet, of Live DJ gepauzeerd: niets te herstellen.
  assert.equal(missingQueued({ ...s, queuedId: null }, [], 'old0'), null);
  assert.equal(missingQueued({ ...s, status: 'gepauzeerd' }, [], 'old0'), null);
});
