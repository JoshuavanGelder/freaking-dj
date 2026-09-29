import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustKind, describeChange, mergeAdjusted } from './adjust.ts';
import type { PlanItem } from './types.ts';

const it = (id: string, name = id, artist = `A-${id}`): PlanItem => ({
  track: { id, name, artists: [artist], durationMs: 200_000 },
  style: 'Pop',
  isNew: false,
  energy: 3,
});
const ids = (l: PlanItem[]) => l.map((x) => x.track.id);

test('adjustKind herkent toevoegen, weghalen en breed', () => {
  assert.deepEqual(adjustKind('doe er Ordinary bij'), { kind: 'toevoegen', count: 1 });
  assert.deepEqual(adjustKind('voeg nog twee nummers van NF toe'), { kind: 'toevoegen', count: 2 });
  assert.deepEqual(adjustKind('zet er 3 nummers van Avicii tussen'), { kind: 'toevoegen', count: 3 });
  assert.equal(adjustKind('ook Golden van KPop Demon Hunters').kind, 'toevoegen');
  assert.equal(adjustKind('nog een nummer van Morgan Wallen').kind, 'toevoegen');
  assert.equal(adjustKind('haal Firestone weg').kind, 'weghalen');
  assert.equal(adjustKind('gooi Kygo eruit').kind, 'weghalen');
  assert.equal(adjustKind('geen Kygo').kind, 'weghalen');
  assert.equal(adjustKind('gooi er Kygo bij').kind, 'toevoegen');
  assert.equal(adjustKind('rustiger').kind, 'breed');
  assert.equal(adjustKind('meer NF').kind, 'breed');
  assert.equal(adjustKind('harder').kind, 'breed');
});

test('toevoegen: alles blijft staan, nieuw nummer op Claudes plek', () => {
  const prev = [it('a'), it('b'), it('c'), it('d')];
  // Claude gooit toch dingen om: c eruit, volgorde anders, x na b.
  const proposed = [it('b'), it('x'), it('a'), it('d')];
  const r = mergeAdjusted(prev, proposed, 'toevoegen');
  assert.deepEqual(ids(r.items), ['a', 'b', 'x', 'c', 'd']);
  assert.deepEqual(ids(r.added), ['x']);
  assert.deepEqual(r.removed, []);
});

test('toevoegen: nieuw nummer vooraan als Claude het als eerste zet', () => {
  const r = mergeAdjusted([it('a'), it('b')], [it('x'), it('a'), it('b')], 'toevoegen');
  assert.deepEqual(ids(r.items), ['x', 'a', 'b']);
});

test('toevoegen: andere versie van een bestaand nummer telt niet als nieuw', () => {
  const r = mergeAdjusted([it('a', 'Believer', 'Imagine Dragons')], [it('a2', 'Believer - Remastered', 'Imagine Dragons'), it('y')], 'toevoegen');
  assert.deepEqual(ids(r.items), ['a', 'y']);
});

test('weghalen: alleen wat Claude wegliet gaat eruit, volgorde blijft', () => {
  const prev = [it('a'), it('b'), it('c'), it('d')];
  const proposed = [it('d'), it('a'), it('z'), it('c')]; // b weg, z nieuw (na a), volgorde door elkaar
  const r = mergeAdjusted(prev, proposed, 'weghalen');
  assert.deepEqual(ids(r.items), ['a', 'z', 'c', 'd']);
  assert.deepEqual(ids(r.removed), ['b']);
  assert.equal(describeChange(r.added.length, r.removed.length), '1 nummer toegevoegd, 1 nummer weggehaald');
});

test('breed: Claudes lijst zoals hij is', () => {
  const r = mergeAdjusted([it('a'), it('b')], [it('c'), it('a')], 'breed');
  assert.deepEqual(ids(r.items), ['c', 'a']);
  assert.deepEqual(ids(r.removed), ['b']);
  assert.deepEqual(ids(r.added), ['c']);
});
