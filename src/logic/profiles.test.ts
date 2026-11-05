import test from 'node:test';
import assert from 'node:assert/strict';
import { profileOf, sameVibe, vibeStats, provenIds, newEveryFor, PROFILE_NOTES } from './profiles.ts';
import { DEFAULT_RULES, delayRepeats, enforce, parseVibe, rejectReason } from './rules.ts';
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

// ---------- herhaling en "geen zin in" zelf beheren ----------
import { addNotNow, clearNotNowGroup, computeSignals, moveNotNow, notNowGroups, removeNotNow } from './learning.ts';

const H = 3600_000;
const pl = (id: string, start: number, outcome: 'full' | 'skip', vibe = 'Gym'): Play => ({
  id, name: id, artist: 'X', lengthMs: 200_000, start, listenedMs: outcome === 'full' ? 200_000 : 40_000, outcome, vibe,
});

test('herhaling: skip van een nummer dat je die dag al hoorde telt niet als "geen zin in"', () => {
  const plays = [pl('fav', NOW - 5 * H, 'full'), pl('a', NOW - 5 * H + 300_000, 'full'), pl('fav', NOW - H, 'skip'), pl('b', NOW - H + 60_000, 'full')];
  const s = computeSignals({ ...EMPTY_LEARNED, plays }, { known: new Set(['fav', 'a', 'b']), now: NOW });
  assert.equal(s.notNow.fav, undefined);
  // Zonder eerdere keer die dag telt dezelfde skip wel.
  const s2 = computeSignals({ ...EMPTY_LEARNED, plays: plays.slice(1) }, { known: new Set(['fav', 'a', 'b']), now: NOW });
  assert.equal(s2.notNow.fav?.length, 1);
  // Ook als Spotify (bv. je pc) het eerder die dag speelde.
  const s3 = computeSignals({ ...EMPTY_LEARNED, plays: plays.slice(1) }, { known: new Set(['fav', 'a', 'b']), now: NOW, recentPlays: [{ id: 'fav', at: NOW - 3 * H }] });
  assert.equal(s3.notNow.fav, undefined);
});

test('geen zin in: wissen, toevoegen, verplaatsen en alles wissen', () => {
  const plays = [pl('a', NOW - 10 * H, 'full'), pl('fav', NOW - 9 * H, 'skip', 'Legday'), pl('b', NOW - 9 * H + 60_000, 'full')];
  let l: Learned = { ...EMPTY_LEARNED, plays };
  const sig = () => computeSignals(l, { known: new Set(['a', 'b', 'fav']), now: NOW });
  assert.equal(notNowGroups(sig(), NOW)[0].group, 'gym');

  // Wissen bij Gym (geskipt bij Legday = zelfde groep).
  l = removeNotNow(l, 'fav', 'Gym', NOW);
  assert.equal(sig().notNow.fav, undefined);

  // Zelf toevoegen bij Coding, verloopt niet.
  l = addNotNow(l, 'x', 'Coding', NOW - 30 * 86400000, { name: 'Song', artist: 'Y' });
  const g = notNowGroups(sig(), NOW);
  assert.deepEqual(g.map((x) => [x.group, x.lines[0].id, x.lines[0].manual]), [['coding', 'x', true]]);
  assert.equal(l.meta.x.name, 'Song');
  const ctx = { rules: DEFAULT_RULES, vibe: parseVibe('coding', DEFAULT_RULES), signals: sig(), now: NOW };
  assert.equal(rejectReason(t('x', 'Song', 'Y'), ctx), 'geen zin in bij deze vibe');

  // Verplaatsen naar Gym.
  l = moveNotNow(l, 'x', 'Coding', 'Gym', NOW);
  assert.deepEqual(notNowGroups(sig(), NOW).map((x) => x.group), ['gym']);
  assert.equal(rejectReason(t('x', 'Song', 'Y'), ctx.signals === sig() ? ctx : { ...ctx, signals: sig() }), null);

  // Alles wissen bij Gym.
  l = clearNotNowGroup(l, notNowGroups(sig(), NOW)[0], NOW);
  assert.deepEqual(notNowGroups(sig(), NOW), []);
});

test('enforce: na herstarten mogen nummers van vandaag blijven, maar niet bovenaan', () => {
  const item = (id: string): PlanItem => ({ track: t(id, id, `Artiest ${id}`), style: 'Pop', isNew: false, energy: 4 });
  const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const rules = { ...DEFAULT_RULES, count: 14 };
  const heard = new Set(['h1', 'h2']);
  const ctx = { rules, vibe: parseVibe('Standaard', rules), signals: NO_SIGNALS, now: NOW, heardRecently: heard };
  const r = enforce([item('h1'), item('h2'), ...ids.map(item)], [], ctx);
  const order = r.items.map((i) => i.track.id);
  assert.equal(order.length, 14, 'niets weggehaald');
  assert.deepEqual(r.removed, []);
  assert.ok(order.slice(0, 8).every((id) => !heard.has(id)), `eerste 8 vers: ${order.join(',')}`);
  assert.ok(order.indexOf('h1') < order.indexOf('h2'));
});

test('delayRepeats: artiestenblokje blijft, te weinig verse nummers = herhalingen zo vroeg als nodig', () => {
  const item = (id: string): PlanItem => ({ track: t(id, id, id), style: 'Pop', isNew: false, energy: 4 });
  const heard = new Set(['h1', 'h2']);
  const out = delayRepeats([item('h1'), item('a'), item('h2'), item('b')], heard, 1);
  assert.deepEqual(out.map((i) => i.track.id), ['h1', 'a', 'b', 'h2']);
});

test('buildRequest: "heard today" gemarkeerd en freshStart meegegeven', () => {
  const pool = buildPool({ topShort: [t('h', 'Again', 'A'), t('n', 'Fresh', 'B')], topMedium: [], topLong: [], recent: [], saved: [] });
  const vibe = parseVibe('Standaard', DEFAULT_RULES);
  const refs = poolForClaude(pool, { rules: DEFAULT_RULES, vibe, signals: NO_SIGNALS, now: NOW });
  const req = buildRequest({ id: 'r', vibe, refs, rules: DEFAULT_RULES, signals: NO_SIGNALS, learned: EMPTY_LEARNED, avoid: [], now: new Date(NOW), model: 'sonnet', heardRecently: new Set(['h']) });
  assert.equal(req.pool, 't1|Again|A|nu|heard today\nt2|Fresh|B|nu');
  assert.match(renderRequest(req), /freshStart: no "heard today" track in the first 8 positions/);
});

test('Standaard: leert van alles behalve worship', () => {
  const learned: Learned = {
    ...EMPTY_LEARNED,
    plays: [play('g', 'Gym', 'full'), play('c', 'Coding', 'full'), play('w', 'Worship', 'full'), play('s', 'Standaard', 'full')],
  };
  assert.deepEqual([...provenIds(vibeStats(learned, 'Standaard'))].sort(), ['c', 'g', 's']);
  assert.deepEqual([...provenIds(vibeStats(learned, 'Gym'))], ['g']);
});
