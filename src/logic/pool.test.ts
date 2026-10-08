import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPool, buildRequest, parseAnswer, poolForClaude } from './pool.ts';
import { idsToAdd, leadingOld, pickDevice, hasOldQueue, type Device } from './queue.ts';
import { responseHealth, summarizeStatus } from './status.ts';
import { DEFAULT_RULES, parseVibe } from './rules.ts';
import { EMPTY_LEARNED } from './learning.ts';
import type { Track } from './types.ts';

const t = (id: string, name: string, artist: string): Track => ({ id, name, artists: [artist], durationMs: 180_000 });
const NOW = Date.parse('2026-09-29T12:00:00Z');

test('buildPool: favorieten eerst, dubbelen eruit, plays geteld', () => {
  const ord = t('ord', 'Ordinary', 'Alex Warren');
  const pool = buildPool({
    topShort: [ord, t('nf', 'Hope', 'NF')],
    topMedium: [t('old', 'Old', 'X')],
    topLong: [t('ac', 'Thunderstruck', 'AC/DC'), t('ord2', 'Ordinary - Remastered', 'Alex Warren')],
    recent: [{ track: ord, playedAt: NOW }, { track: ord, playedAt: NOW - 1 }, { track: t('r', 'Recent', 'Y'), playedAt: NOW }],
    saved: [t('sv', 'Saved', 'Z')],
  });
  assert.deepEqual(pool.map((p) => p.id), ['ord', 'nf', 'r', 'old', 'ac', 'sv']);
  assert.equal(pool[0].plays, 2);
  assert.equal(pool.find((p) => p.id === 'ac')?.tier, 'ouder');
});

test('poolForClaude: zonder blocklist/worship, met korte refs', () => {
  const pool = buildPool({
    topShort: [t('a', 'Tattoo', 'Loreen'), t('b', 'Gratitude', 'Brandon Lake'), t('c', 'Hope', 'NF')],
    topMedium: [], topLong: [], recent: [], saved: [],
  });
  const ctx = { rules: DEFAULT_RULES, vibe: parseVibe('coding', DEFAULT_RULES), signals: { resting: {}, notNow: {}, suspicions: [], disliked: [] }, now: NOW };
  const refs = poolForClaude(pool, ctx);
  assert.deepEqual(refs.map((r) => [r.ref, r.track.id]), [['t1', 'c']]);
  const req = buildRequest({
    id: 'x1', vibe: ctx.vibe, refs, rules: DEFAULT_RULES, signals: ctx.signals, learned: EMPTY_LEARNED, avoid: [], now: new Date(NOW), model: 'sonnet',
  });
  assert.equal(req.pool, 't1|Hope|NF|nu');
  assert.equal(req.mode, 'nieuw');
  assert.equal(req.worshipAllowed, false);
});

test('parseAnswer: robuust', () => {
  assert.equal(parseAnswer(null), null);
  assert.equal(parseAnswer({ items: [] }), null);
  const a = parseAnswer({ title: 'T', items: [{ ref: 't1' }, { title: 'X' }, { title: 'New', artist: 'Y', new: true, energy: 9, style: '' }] });
  assert.equal(a?.items.length, 2);
  assert.equal(a?.items[1].energy, 5);
  assert.equal(a?.items[1].style, 'Overig');
});

const dev = (name: string, type: string, isActive = false): Device => ({ id: name, name, type, isActive, isRestricted: false, supportsVolume: true, volume: 50 });

test('pickDevice: actief apparaat, anders pc, nooit de Denon', () => {
  const phone = dev('Galaxy S25', 'Smartphone', true);
  const pc = dev('joshua-mooore', 'Computer');
  const denon = dev('Denon AVR-X2800H', 'AVR');
  const a = pickDevice([pc, phone, denon], 'joshua-mooore', ['Denon']);
  assert.ok(a.ok && a.device.name === 'Galaxy S25' && !a.start);
  const b = pickDevice([{ ...phone, isActive: false }, pc, denon], 'joshua-mooore', ['Denon']);
  assert.ok(b.ok && b.device.name === 'joshua-mooore' && b.start);
  const c = pickDevice([denon], 'joshua-mooore', ['Denon']);
  assert.equal(c.ok, false);
  // Speelt de Denon al? Dan blijft het daar (nooit uit zichzelf overzetten).
  const d = pickDevice([{ ...denon, isActive: true }, pc], 'joshua-mooore', ['Denon']);
  assert.ok(d.ok && d.device.type === 'AVR');
});

test('idsToAdd: alleen achteraan wat er nog niet in staat', () => {
  assert.deepEqual(idsToAdd(['a', 'b', 'c', 'b', 'd'], ['c'], 'a'), ['b', 'd']);
});

test('leadingOld: oude nummers vóór de nieuwe tellen', () => {
  assert.equal(leadingOld(['o1', 'o2', 'n2', 'n3'], ['o1', 'o2', 'o3'], ['n1', 'n2', 'n3']), 2);
  assert.equal(leadingOld(['n2'], ['o1'], ['n1', 'n2']), 0);
  assert.equal(leadingOld(['auto1', 'o1'], ['o1'], ['n1']), 0);
  assert.equal(hasOldQueue(['a', 'x'], ['a']), true);
  assert.equal(hasOldQueue([], ['a']), false);
});

test('status: statuspagina en limiet', () => {
  assert.equal(summarizeStatus({ components: [{ name: 'Claude Code', status: 'operational' }] }).level, 'ok');
  assert.equal(summarizeStatus({ components: [{ name: 'Claude Code', status: 'major_outage' }] }).level, 'storing');
  assert.equal(summarizeStatus({ components: [], incidents: [{ name: 'Elevated errors', status: 'investigating' }] }).level, 'let op');
  assert.equal(summarizeStatus(null).level, 'onbekend');
  const r = responseHealth({ id: 'x', status: 'limiet', message: '', resetAt: '17:00', answer: null, finishedAt: new Date(NOW).toISOString() }, NOW + 1000);
  assert.match(r?.text ?? '', /17:00/);
  assert.equal(responseHealth({ id: 'x', status: 'ok', message: '', resetAt: null, answer: null, finishedAt: new Date(NOW).toISOString() }, NOW), null);
  const tok = { id: 'x', status: 'token' as const, message: '', resetAt: null, answer: null, finishedAt: new Date(NOW).toISOString() };
  assert.match(responseHealth(tok, NOW + 60_000)?.text ?? '', /token/);
  assert.equal(responseHealth(tok, NOW + 3 * 3600_000), null);
});

test('bestMatch: zelfde artiest en titel, anders niets', async () => {
  const { bestMatch } = await import('./pool.ts');
  const c = [t('1', 'Viva, Moldova! (Eurovision 2026)', 'Satoshi'), t('2', 'Viva Moldova', 'Iemand Anders')];
  assert.equal(bestMatch(c, 'Viva, Moldova!', 'Satoshi')?.id, '1');
  assert.equal(bestMatch([t('3', 'Golden', 'HUNTR/X')], 'Golden', 'HUNTR/X')?.id, '3');
  assert.equal(bestMatch([t('4', 'Golden', 'Harry Styles')], 'Golden', 'HUNTR/X'), null);
});

test('base64 met accenten', async () => {
  const { utf8ToBase64 } = await import('./base64.ts');
  assert.equal(utf8ToBase64('Voilà'), Buffer.from('Voilà').toString('base64'));
  assert.equal(utf8ToBase64('ab'), 'YWI=');
  assert.equal(utf8ToBase64(''), '');
});

test('parseAnswer: haalt losse tags uit titels', () => {
  const a = parseAnswer({ title: '<parameter name="title">Coding Focus Mix', note: ' ok ', items: [{ ref: 't1', style: '<b>Pop</b>' }] });
  assert.equal(a?.title, 'Coding Focus Mix');
  assert.equal(a?.items[0].style, 'Pop');
});
