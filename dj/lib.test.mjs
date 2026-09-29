import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractJson, parseCliOutput, parseReset, renderRequest, validId } from './lib.mjs';

test('ids', () => {
  assert.equal(validId('mg1abc-xyz'), true);
  assert.equal(validId('../../etc'), false);
  assert.equal(validId(''), false);
});

test('ok met structured_output', () => {
  const out = { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { title: 'x', note: '', items: [{}], spares: [] } };
  const r = classify(out, '', 0);
  assert.equal(r.status, 'ok');
  assert.equal(r.answer.title, 'x');
});

test('ok met JSON in de tekst', () => {
  const out = { subtype: 'success', is_error: false, result: 'Hier:\n```json\n{"title":"a","note":"","items":[{"ref":"t1"}],"spares":[]}\n```' };
  assert.equal(classify(out, '', 0).status, 'ok');
});

test('limiet met epoch', () => {
  const out = { subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1759248000' };
  const r = classify(out, '', 1);
  assert.equal(r.status, 'limiet');
  assert.match(r.resetAt, /\d{2}:\d{2}/);
});

test('limiet met resets-tekst', () => {
  const r = classify(null, "You've hit your limit · resets 5pm (Europe/Amsterdam)", 1);
  assert.equal(r.status, 'limiet');
  assert.equal(r.resetAt, '5pm (Europe/Amsterdam)');
});

test('token verlopen', () => {
  const r = classify({ is_error: true, result: 'Invalid bearer token' }, '', 1);
  assert.equal(r.status, 'token');
});

test('andere fout', () => {
  const r = classify({ is_error: true, subtype: 'error_max_turns', result: 'Reached max turns' }, '', 1);
  assert.equal(r.status, 'fout');
});

test('parseReset zonder info', () => assert.equal(parseReset('niets'), null));

test('extractJson zonder items', () => assert.equal(extractJson('{"a":1}'), null));

test('parseCliOutput pakt het JSON-object', () => {
  assert.deepEqual(parseCliOutput('warning: x\n{"a":1}\n'), { a: 1 });
  assert.equal(parseCliOutput(''), null);
});

test('renderRequest bevat vibe, regels en pool', () => {
  const t = renderRequest({
    mode: 'nieuw', vibe: 'coding', now: 'dinsdag 14:00', count: 25, spares: 8, newEvery: 4,
    artistStart: null, worshipAllowed: false, eurovision: false, eurovisionFavorite: 'Viva, Moldova! – Satoshi',
    rules: ['r1'], taste: ['t1'], blockedArtists: ['Loreen'], worshipArtists: ['Hillsong'],
    learned: { jumpTargets: [], notInThisVibe: [], suspectedDislike: ['Firestone – Kygo'], disliked: [], resting: [] },
    avoid: [], previous: [], pool: 't1|Ordinary|Alex Warren|nu',
  });
  assert.match(t, /vibe: coding/);
  assert.match(t, /Loreen/);
  assert.match(t, /Firestone/);
  assert.match(t, /t1\|Ordinary/);
  assert.match(t, /3–4 known/);
});

test('pendingIds: alleen recente verzoeken zonder antwoord, oudste eerst', async () => {
  const { pendingIds } = await import('./lib.mjs');
  const now = Date.parse('2026-09-29T12:00:00Z');
  const reqs = [
    { id: 'bbb-2', createdAt: '2026-09-29T11:59:00Z' },
    { id: 'aaa-1', createdAt: '2026-09-29T11:58:00Z' },
    { id: 'old-1', createdAt: '2026-09-29T10:00:00Z' },
    { id: 'done-1', createdAt: '2026-09-29T11:59:30Z' },
    { id: 'bad', createdAt: null },
    { id: '../x', createdAt: '2026-09-29T11:59:00Z' },
  ];
  assert.deepEqual(pendingIds(reqs, new Set(['done-1']), now), ['aaa-1', 'bbb-2']);
});

test('renderRequest noemt de soort bijsturing', () => {
  const t = renderRequest({ mode: 'bijsturen', vibe: 'coding', adjust: 'doe er Ordinary bij', adjustMode: 'toevoegen', count: 26, spares: 5, newEvery: 4, learned: {}, pool: '', previous: [] });
  assert.match(t, /adjustMode: toevoegen/);
  assert.match(t, /count: 26/);
});
