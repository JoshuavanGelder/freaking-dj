import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES,
  artistFirst,
  consecutiveClashes,
  enforce,
  groupByStyle,
  parseVibe,
  pickReplacement,
  rejectReason,
  spreadArtists,
  type EnforceContext,
} from './rules.ts';
import type { PlanItem, PoolTrack, Signals, Track } from './types.ts';
import { songKey } from './text.ts';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const noSignals = (): Signals => ({ resting: {}, notNow: {}, suspicions: [], disliked: [] });

let n = 0;
function tr(name: string, artist: string | string[], id?: string): Track {
  n++;
  return { id: id ?? `id${n}`, name, artists: Array.isArray(artist) ? artist : [artist], durationMs: 200_000 };
}
function it(name: string, artist: string | string[], style = 'Pop', extra: Partial<PlanItem> = {}): PlanItem {
  return { track: tr(name, artist), style, isNew: false, energy: 3, ...extra };
}
function ctx(vibe = 'coding', over: Partial<EnforceContext> = {}): EnforceContext {
  return { rules: DEFAULT_RULES, vibe: parseVibe(vibe, DEFAULT_RULES), signals: noSignals(), now: NOW, ...over };
}

test('parseVibe: begin met artiest', () => {
  assert.equal(parseVibe('begin met Morgan Wallen', DEFAULT_RULES).artistStart, 'Morgan Wallen');
  assert.equal(parseVibe('Coding, begin met NF en daarna rustig', DEFAULT_RULES).artistStart, 'NF');
  assert.equal(parseVibe('gym', DEFAULT_RULES).artistStart, null);
});

test('parseVibe: worship en eurovisie', () => {
  assert.equal(parseVibe('worship', DEFAULT_RULES).worship, true);
  assert.equal(parseVibe('zondag met Brandon Lake', DEFAULT_RULES).worship, true);
  assert.equal(parseVibe('coding', DEFAULT_RULES).worship, false);
  assert.equal(parseVibe('Eurovision', DEFAULT_RULES).eurovision, true);
  assert.equal(parseVibe('songfestival 2026', DEFAULT_RULES).eurovision, true);
});

test('nooit Loreen, ook niet als feat.', () => {
  assert.equal(rejectReason(tr('Tattoo', 'Loreen'), ctx()), 'blocklist');
  assert.equal(rejectReason(tr('Iets', ['X', 'Loreen']), ctx()), 'blocklist');
  assert.equal(rejectReason(tr('Euphoria', 'loreen'), ctx('eurovisie')), 'blocklist');
});

test('worship alleen op verzoek', () => {
  assert.equal(rejectReason(tr('Gratitude', 'Brandon Lake'), ctx('coding')), 'worship alleen op verzoek');
  assert.equal(rejectReason(tr('Oceans', 'Hillsong UNITED'), ctx('gym')), 'worship alleen op verzoek');
  assert.equal(rejectReason(tr('Oceans', 'Hillsong UNITED'), ctx('worship')), null);
});

test('rust en niet leuk', () => {
  const s = noSignals();
  const a = tr('Ordinary', 'Alex Warren', 'ord');
  s.resting.ord = NOW + 86400000;
  assert.equal(rejectReason(a, ctx('coding', { signals: s })), 'rust (te vaak gedraaid)');
  s.disliked.push('fire');
  assert.equal(rejectReason(tr('Firestone', 'Kygo', 'fire'), ctx('coding', { signals: s })), 'niet leuk (bevestigd)');
  const keys = new Set(['firestone|kygo']);
  assert.equal(rejectReason(tr('Firestone - Radio Edit', 'Kygo', 'fire2'), ctx('coding', { dislikedKeys: keys })), 'niet leuk (bevestigd)');
});

test('geen zin in geldt alleen voor dezelfde vibe', () => {
  const s = noSignals();
  s.notNow.cs = [{ vibe: 'Coding', hour: 10, at: NOW - 86400000 }];
  const cs = tr('Counting Stars', 'OneRepublic', 'cs');
  assert.equal(rejectReason(cs, ctx('coding', { signals: s })), 'geen zin in bij deze vibe');
  assert.equal(rejectReason(cs, ctx('gym', { signals: s })), null);
});

test('enforce: dubbelen, blocklist en al in wachtrij eruit', () => {
  const a = it('Believer', 'Imagine Dragons');
  const b = { ...it('Believer (Remastered)', 'Imagine Dragons') };
  const c = it('Tattoo', 'Loreen');
  const d = it('Wake Me Up', 'Avicii');
  const q = new Set([d.track.id]);
  const r = enforce([a, b, c, d], [], ctx('coding', { alreadyQueued: q }));
  assert.deepEqual(r.items.map((x) => x.track.name), ['Believer']);
  assert.deepEqual(r.removed.map((x) => x.reason).sort(), ['blocklist', 'dubbel', 'staat al in je wachtrij']);
});

test('enforce: een andere versie van wat al speelt of klaarstaat komt er ook niet in', () => {
  const playing = tr('Hope (Remastered 2020)', 'NF', 'p1');
  const again = it('Hope', 'NF'); // ander id, zelfde nummer
  const fresh = it('Wake Me Up', 'Avicii');
  const c = ctx('coding', { alreadyQueued: new Set([playing.id]), alreadyKeys: new Set([songKey(playing.name, playing.artists)]) });
  assert.equal(rejectReason(again.track, c), 'staat al in je wachtrij');
  const r = enforce([again, fresh], [], c);
  assert.deepEqual(r.items.map((x) => x.track.name), ['Wake Me Up']);
});

test('enforce: eurovisie-favoriet zit er altijd in, op plek 3', () => {
  const fav = tr('Viva, Moldova!', 'Satoshi', 'viva');
  const items = [it('Arcade', 'Duncan Laurence'), it('Heroes', 'Måns Zelmerlöw'), it('Fuego', 'Eleni Foureira'), it('SHUM', 'Go_A')];
  const r = enforce(items, [], ctx('Eurovisie', { favorite: fav }));
  assert.equal(r.items[2].track.id, 'viva');
  assert.equal(r.items.length, 5);
  // Niet bij andere vibes.
  const r2 = enforce(items, [], ctx('coding', { favorite: fav }));
  assert.ok(!r2.items.some((x) => x.track.id === 'viva'));
});

test('enforce: favoriet blijft ook bij inkorten', () => {
  const fav = tr('Viva, Moldova!', 'Satoshi', 'viva2');
  const items = Array.from({ length: 30 }, (_, i) => it(`Song ${i}`, `Artist ${i}`));
  items.push({ track: fav, style: 'Pop', isNew: false, energy: 4 });
  const r = enforce(items, [], ctx('eurovisie', { favorite: fav }));
  assert.equal(r.items.length, 25);
  assert.ok(r.items.some((x) => x.track.id === 'viva2'));
});

test('enforce: favoriet is vrijgesteld van rust', () => {
  const fav = tr('Viva, Moldova!', 'Satoshi', 'viva3');
  const s = noSignals();
  s.resting.viva3 = NOW + 1e9;
  assert.equal(rejectReason(fav, ctx('eurovisie', { signals: s })), null);
});

test('begin met Morgan Wallen: blokje van 3 vooraan, rest verspreid', () => {
  const mw = (t: string) => it(t, 'Morgan Wallen', 'Country');
  const items = [
    it('A', 'NF'), mw('Last Night'), it('B', 'Avicii'), mw('Thought You Should Know'), it('C', 'Green Day'),
    mw('Lies Lies Lies'), it('D', 'AC/DC'), mw('7 Summers'), it('E', 'Sean Paul'), mw('Cowgirls'), it('F', 'OneRepublic'),
    it('G', 'Egzod'), it('H', 'Flo Rida'),
  ];
  const r = artistFirst(items, 'Morgan Wallen');
  assert.equal(r.block, 3);
  assert.deepEqual(r.items.slice(0, 3).map((x) => x.track.artists[0]), ['Morgan Wallen', 'Morgan Wallen', 'Morgan Wallen']);
  assert.notEqual(r.items[3].track.artists[0], 'Morgan Wallen');
  const later = r.items.slice(3).map((x, i) => (x.track.artists[0] === 'Morgan Wallen' ? i : -1)).filter((i) => i >= 0);
  assert.equal(later.length, 2);
  assert.ok(later[1] - later[0] > 1, 'verspreid');
  const e = enforce(items, [], ctx('begin met Morgan Wallen'));
  assert.equal(consecutiveClashes(e.items, 3), 0);
});

test('spreadArtists: nooit twee keer dezelfde artiest achter elkaar', () => {
  const items = [
    it('1', 'NF'), it('2', 'NF'), it('3', 'Avicii'), it('4', 'Avicii'), it('5', 'Green Day'), it('6', 'Sean Paul'),
    it('7', ['LUM!X', 'Gabry Ponte']), it('8', 'Gabry Ponte'), it('9', 'AC/DC'),
  ];
  const r = spreadArtists(items);
  assert.equal(consecutiveClashes(r), 0);
  assert.equal(r.length, items.length);
});

test('groupByStyle houdt volgorde en indexen', () => {
  const g = groupByStyle([it('a', 'x', 'Country'), it('b', 'y', 'EDM'), it('c', 'z', 'country')]);
  assert.deepEqual(g.map((x) => x.style), ['Country', 'EDM']);
  assert.deepEqual(g[0].entries.map((e) => e.index), [0, 2]);
});

test('pickReplacement: eerst reserve met dezelfde stijl, niet naast dezelfde artiest', () => {
  const items = [it('a', 'NF', 'Rap'), it('b', 'Avicii', 'EDM'), it('c', 'Green Day', 'Punk')];
  const spares = [it('s1', 'NF', 'EDM'), it('s2', 'Alan Walker', 'EDM'), it('s3', 'Egzod', 'Rap')];
  const r = pickReplacement(items, spares, 1, [], ctx());
  assert.equal(r?.item.track.name, 's2');
  assert.equal(r?.spares.length, 3); // oude gaat naar de reserves
});

test('pickReplacement: uit de geschiedenis als er geen reserve is', () => {
  const items = [it('a', 'NF', 'Rap'), it('b', 'Avicii', 'EDM'), it('c', 'Green Day', 'Punk')];
  const pool: PoolTrack[] = [
    { ...tr('Tattoo', 'Loreen'), tier: 'nu', plays: 5 },
    { ...tr('Faded', 'Alan Walker'), tier: 'nu', plays: 2 },
  ];
  const r = pickReplacement(items, [], 1, pool, ctx());
  assert.equal(r?.item.track.name, 'Faded');
});
