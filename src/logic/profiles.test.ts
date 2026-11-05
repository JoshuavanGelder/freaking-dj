import test from 'node:test';
import assert from 'node:assert/strict';
import { profileOf, sameVibe, vibeStats, provenIds, newEveryFor, PROFILE_NOTES } from './profiles.ts';
import { DEFAULT_RULES, enforce, parseVibe, rejectReason } from './rules.ts';
import { buildPool, buildRequest, poolForClaude } from './pool.ts';
import { EMPTY_LEARNED, tagPlays } from './learning.ts';
import { renderRequest } from '../../dj/lib.mjs';
import type { Learned, Play, PlanItem, Signals, Track } from './types.ts';

const t = (id: string, name: string, artist: string): Track => ({ id, name, artists: [artist], durationMs: 180_000 });
const NOW = Date.parse('2026-11-05T09:00:00Z');
const NO_SIGNALS: Signals = { resting: {}, notNow: {}, suspicions: [], disliked: [] };
const play = (id: string, vibe: string, outcome: 'full' | 'skip', start = NOW - 86400000): Play => ({
  id, name: id, artist: 'X', lengthMs: 180_000, start, listenedMs: outcome === 'full' ? 180_000 : 20_000, outcome, vibe,
});

test('profileOf: de vaste vibes worden herkend', () => {
  assert.equal(profileOf('Standaard'), 'standaard');
  assert.equal(profileOf('standaard, begin met Morgan Wallen'), 'standaard');
  assert.equal(profileOf('Gym'), 'gym');
  assert.equal(profileOf('Legday'), 'gym');
  assert.equal(profileOf('leg day'), 'gym');
  assert.equal(profileOf('push day sportschool'), 'gym');
  assert.equal(profileOf('Worship'), 'worship');
  assert.equal(profileOf('christelijke muziek'), 'worship');
  assert.equal(profileOf('Coding'), 'overig');
  assert.equal(profileOf('Eurovisie'), 'overig');
  assert.equal(profileOf('standaard maar dan rustig'), 'overig');
});

test('sameVibe: Legday en Gym leren van elkaar, overige vibes alleen bij dezelfde tekst', () => {
  assert.ok(sameVibe('Legday', 'Gym'));
  assert.ok(sameVibe('Coding', 'coding'));
  assert.ok(!sameVibe('Coding', 'Frans'));
  assert.ok(!sameVibe('Gym', 'Standaard'));
});

test('parseVibe: profiel erbij, worship-profiel staat worship toe', () => {
  assert.equal(parseVibe('Gym', DEFAULT_RULES).profile, 'gym');
  assert.equal(parseVibe('Worship', DEFAULT_RULES).worship, true);
  assert.equal(parseVibe('Standaard', DEFAULT_RULES).worship, false);
});

test('vibeStats/provenIds: alleen bewezen als vaker helemaal gehoord dan geskipt', () => {
  const learned: Learned = {
    ...EMPTY_LEARNED,
    plays: [play('a', 'Legday', 'full'), play('a', 'Gym', 'full'), play('b', 'Gym', 'full'), play('b', 'Gym', 'skip'), play('c', 'Coding', 'full')],
  };
  const stats = vibeStats(learned, 'gym');
  assert.deepEqual(stats.get('a'), { full: 2, skips: 0 });
  assert.equal(stats.has('c'), false);
  assert.deepEqual([...provenIds(stats)], ['a']);
});

test('Gym: geskipt bij Legday telt ook als "geen zin in" bij Gym', () => {
  const signals: Signals = { ...NO_SIGNALS, notNow: { x: [{ vibe: 'Legday', hour: 9, at: NOW - 86400000 }] } };
  const ctx = { rules: DEFAULT_RULES, vibe: parseVibe('Gym', DEFAULT_RULES), signals, now: NOW };
  assert.equal(rejectReason(t('x', 'Ballad', 'Y'), ctx), 'geen zin in bij deze vibe');
  const coding = { ...ctx, vibe: parseVibe('Coding', DEFAULT_RULES) };
  assert.equal(rejectReason(t('x', 'Ballad', 'Y'), coding), null);
});

test('enforce Gym: te rustige nummers eruit, aangevuld uit reserves; bewezen gym-nummers mogen altijd', () => {
  const item = (id: string, artist: string, energy: number): PlanItem => ({ track: t(id, id, artist), style: 'Rap', isNew: false, energy });
  const rules = { ...DEFAULT_RULES, count: 3 };
  const ctx = { rules, vibe: parseVibe('Gym', rules), signals: NO_SIGNALS, now: NOW, proven: new Set(['proven']) };
  const r = enforce(
    [item('hard', 'A', 5), item('soft', 'B', 2), item('proven', 'C', 3), item('mid', 'D', 3)],
    [item('spareSoft', 'E', 2), item('spareHard', 'F', 4)],
    ctx,
  );
  assert.deepEqual(r.items.map((i) => i.track.id), ['hard', 'proven', 'spareHard']);
  assert.deepEqual(r.removed.map((x) => x.reason), ['te rustig voor de gym', 'te rustig voor de gym']);
  assert.deepEqual(r.spares.map((i) => i.track.id), []);
  // Buiten de gym verandert er niets.
  const coding = enforce([item('soft', 'B', 2)], [], { ...ctx, vibe: parseVibe('Coding', rules) });
  assert.equal(coding.items.length, 1);
});

test('buildRequest: profiel, uitleg, minder nieuw bij Gym en bewezen nummers vooraan gemarkeerd', () => {
  const pool = buildPool({
    topShort: [t('ord', 'Ordinary', 'Alex Warren'), t('nf', 'The Search', 'NF')],
    topMedium: [], topLong: [], recent: [], saved: [],
  });
  const learned: Learned = {
    ...EMPTY_LEARNED,
    plays: [play('nf', 'Legday', 'full'), play('nf', 'Legday', 'full'), play('gone', 'Gym', 'full')],
    meta: { gone: { name: 'Till I Collapse', artist: 'Eminem' } },
  };
  const vibe = parseVibe('Gym', DEFAULT_RULES);
  const stats = vibeStats(learned, vibe.text);
  const ctx = { rules: DEFAULT_RULES, vibe, signals: NO_SIGNALS, now: NOW, proven: provenIds(stats) };
  const refs = poolForClaude(pool, ctx);
  assert.equal(refs[0].track.id, 'nf');
  const req = buildRequest({ id: 'g1', vibe, refs, rules: DEFAULT_RULES, signals: NO_SIGNALS, learned, avoid: [], now: new Date(NOW), model: 'sonnet', stats });
  assert.equal(req.profile, 'gym');
  assert.equal(req.newEvery, newEveryFor('gym', DEFAULT_RULES.newEvery));
  assert.ok(req.newEvery >= 6);
  assert.deepEqual(req.profileNotes, PROFILE_NOTES.gym);
  assert.equal(req.pool.split('\n')[0], 't1|The Search|NF|nu|here 2x');
  assert.deepEqual(req.provenExtra, ['Till I Collapse – Eminem']);
  const text = renderRequest(req);
  assert.match(text, /- profile: gym/);
  assert.match(text, /Profile GYM/);
  assert.match(text, /Till I Collapse – Eminem/);
});

test('tagPlays: Live DJ-nummers (ook reserves) krijgen de Live-vibe', () => {
  const p: Play = { ...play('sp', 'x', 'full', NOW), vibe: undefined };
  const out = tagPlays([p], [], { vibe: 'Gym', startedAt: NOW - 1000, ids: ['sp'], newIds: [] });
  assert.equal(out[0].vibe, 'Gym');
  const before = tagPlays([{ ...p, start: NOW - 3600000 }], [], { vibe: 'Gym', startedAt: NOW, ids: ['sp'], newIds: [] });
  assert.equal(before[0].vibe, undefined);
});
