import test from 'node:test';
import assert from 'node:assert/strict';
import { artistTracks, boostWanted, knownArtists, updateWishes, wishArtists } from './wishes.ts';
import { DEFAULT_RULES, enforce, parseVibe, rejectReason, type EnforceContext } from './rules.ts';
import type { PlanItem, PoolTrack, Signals, Track } from './types.ts';

const KNOWN = ['Alex Warren', 'NF', 'Eminem', 'AC/DC', 'Bon Jovi', 'Morgan Wallen', 'Macklemore', 'Macklemore & Ryan Lewis', 'Imagine Dragons'];

test('wens: "meer alex warren" en varianten', () => {
  assert.deepEqual(wishArtists('meer alex warren', KNOWN).more, ['Alex Warren']);
  assert.deepEqual(wishArtists('Meer van Alex Warren graag!', KNOWN).more, ['Alex Warren']);
  assert.deepEqual(wishArtists('alex warren', KNOWN).more, ['Alex Warren'], 'alleen de naam');
  assert.deepEqual(wishArtists('ik wil even Alex Warren luisteren', KNOWN).more, ['Alex Warren']);
  assert.deepEqual(wishArtists('veel meer NF', KNOWN).more, ['NF']);
});

test('wens: geen artiest = niets (dat doet Claude)', () => {
  assert.deepEqual(wishArtists('meer pop/pop rock', KNOWN), { more: [], less: [] });
  assert.deepEqual(wishArtists('rustiger', KNOWN), { more: [], less: [] });
  assert.deepEqual(wishArtists('Bloodline van Alex Warren was goed', KNOWN).more, [], 'genoemd zonder vraag');
});

test('wens: meer en minder in één zin, en ontkenning', () => {
  const w = wishArtists('meer Morgan Wallen, minder AC/DC en Bon Jovi', KNOWN);
  assert.deepEqual(w.more, ['Morgan Wallen']);
  assert.deepEqual(w.less.sort(), ['AC/DC', 'Bon Jovi']);
  assert.deepEqual(wishArtists('geen nummers meer van NF', KNOWN), { more: [], less: ['NF'] });
  assert.deepEqual(wishArtists('niet meer NF', KNOWN), { more: [], less: ['NF'] });
  assert.deepEqual(wishArtists('geen Eminem maar meer NF', KNOWN), { more: ['NF'], less: ['Eminem'] });
  assert.deepEqual(wishArtists('meer Macklemore & Ryan Lewis', KNOWN).more, ['Macklemore & Ryan Lewis'], 'langste naam wint');
});

test('wens blijft de sessie staan: nieuwe "meer" vervangt, "genoeg/minder" haalt weg, iets anders laat staan', () => {
  let w = updateWishes([], 'meer alex warren', KNOWN);
  assert.deepEqual(w, ['Alex Warren']);
  w = updateWishes(w, 'meer pop/pop rock', KNOWN);
  assert.deepEqual(w, ['Alex Warren'], 'breed bijsturen zonder artiest: wens blijft');
  w = updateWishes(w, 'meer NF', KNOWN);
  assert.deepEqual(w, ['NF']);
  w = updateWishes(w, 'genoeg NF', KNOWN);
  assert.deepEqual(w, []);
});

test('knownArtists: uit geschiedenis, geleerde nummers en de sessie', () => {
  const pool = [{ id: 'a', name: 'Ordinary', artists: ['Alex Warren'], durationMs: 1, tier: 'nu', plays: 1 }] as PoolTrack[];
  const k = knownArtists(pool, { x: { name: 'Bloodline', artist: 'Alex Warren, Jelly Roll' } }, [{ id: 'b', name: 'Lose Yourself', artists: ['Eminem'], durationMs: 1 }]);
  assert.deepEqual(k.sort(), ['Alex Warren', 'Eminem', 'Jelly Roll']);
});

let n = 0;
const tr = (name: string, artist: string | string[]): Track => ({ id: `id${++n}`, name, artists: Array.isArray(artist) ? artist : [artist], durationMs: 200_000 });
const it = (name: string, artist: string | string[], extra: Partial<PlanItem> = {}): PlanItem => ({ track: tr(name, artist), style: 'Pop-rock', isNew: false, energy: 5, ...extra });

test('aanvullen: elk tweede nummer van de gevraagde artiest, uit lijst, reserves en Spotify', () => {
  const items = [it('Leave Me Alone', 'NF'), it("You Can't Stop This", 'Alex Warren'), it('Levitating', 'Dua Lipa'), it('The Phoenix', 'Fall Out Boy'), it('High Hopes', 'Panic! At The Disco'), it('Venom', 'Eminem')];
  const spares = [it('Bones', 'Imagine Dragons'), it('Ordinary', 'Alex Warren')];
  const extra = [it('Carry You Home', 'Alex Warren'), it('Ordinary', 'Alex Warren'), it('Eternity', 'Alex Warren')];
  const b = boostWanted(items, spares, extra, ['Alex Warren']);
  assert.equal(b.items.length, items.length, 'lengte blijft gelijk');
  assert.deepEqual(
    b.items.map((x) => x.track.name),
    ["You Can't Stop This", 'Leave Me Alone', 'Ordinary', 'Levitating', 'Carry You Home', 'The Phoenix'],
  );
  assert.equal(b.items.filter((x) => x.track.name === 'Ordinary').length, 1, 'geen dubbele versie');
  assert.deepEqual(b.spares.map((x) => x.track.name), ['Eternity', 'High Hopes', 'Venom', 'Bones'], 'rest gevraagd eerst, dan de rest');
});

test('aanvullen: twee gevraagde artiesten om en om, en niets als er geen wens is', () => {
  const items = [it('A1', 'NF'), it('B1', 'Eminem'), it('O1', 'X'), it('O2', 'Y'), it('A2', 'NF'), it('B2', 'Eminem'), it('O3', 'Z'), it('O4', 'Q')];
  const b = boostWanted(items, [], [], ['NF', 'Eminem']);
  assert.deepEqual(b.items.map((x) => x.track.name), ['A1', 'O1', 'B1', 'O2', 'A2', 'O3', 'B2', 'O4']);
  assert.deepEqual(boostWanted(items, [], [], []).items, items);
});

test('Spotify-zoekresultaten: alleen echte nummers van de artiest', () => {
  const found = [tr('Ordinary', 'Alex Warren'), tr('Ordinary - Sped Up', 'Alex Warren'), tr('Ordinary (Acoustic)', 'Alex Warren'), tr('Bloodline', ['Alex Warren', 'Jelly Roll']), tr('Ordinary', 'Cover Band'), tr('Ordinary', 'Alex Warren')];
  assert.deepEqual(artistTracks(found, ['Alex Warren']).map((t) => t.name), ['Ordinary', 'Bloodline']);
});

const noSignals = (): Signals => ({ resting: {}, notNow: {}, patterns: [], disliked: [] });
const ctx = (vibe: string, over: Partial<EnforceContext> = {}): EnforceContext => ({ rules: DEFAULT_RULES, vibe: parseVibe(vibe, DEFAULT_RULES), signals: noSignals(), now: Date.now(), ...over });

test('gym + "meer Alex Warren": zijn nummers blijven staan, ook onder de energie-ondergrens', () => {
  const items = [it('Ordinary', 'Alex Warren', { energy: 2 }), it('Till I Collapse', 'Eminem', { energy: 5 }), it('Heathens', 'Twenty One Pilots', { energy: 3 })];
  const without = enforce(items, [], ctx('Gym'));
  assert.deepEqual(without.items.map((x) => x.track.name), ['Till I Collapse']);
  const withWish = enforce(items, [], ctx('Gym', { moreArtists: ['Alex Warren'] }));
  assert.deepEqual(withWish.items.map((x) => x.track.name).sort(), ['Ordinary', 'Till I Collapse']);
});

test('gevraagde artiest: artiest-patroon telt even niet, nummer-patroon wel', () => {
  const s = noSignals();
  const base = { songs: 3, isNew: false, vibe: null, first: 0, last: 0, phase: 'nu' as const, reason: 'x' };
  s.patterns = [
    { kind: 'artist', key: 'alex warren', id: 'alex warren', name: 'Alex Warren', artist: 'Alex Warren', level: 'weg', skips: 3, ...base },
    { kind: 'song', key: 'carry you home|alex warren', id: 'cyh', name: 'Carry You Home', artist: 'Alex Warren', level: 'weg', skips: 4, ...base },
  ];
  const ord = tr('Ordinary', 'Alex Warren');
  assert.match(rejectReason(ord, ctx('Standaard', { signals: s })) ?? '', /steeds geskipt/);
  assert.equal(rejectReason(ord, ctx('Standaard', { signals: s, moreArtists: ['Alex Warren'] })), null);
  const cyh = { ...tr('Carry You Home', 'Alex Warren'), id: 'cyh' };
  assert.equal(rejectReason(cyh, ctx('Standaard', { signals: s, moreArtists: ['Alex Warren'] })), 'waarschijnlijk niet meer leuk');
});
