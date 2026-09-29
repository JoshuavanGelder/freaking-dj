import test from 'node:test';
import assert from 'node:assert/strict';
import { fixTranscript, soundKey, speechHints } from './speech.ts';

const hints = ['Legday', 'Rustige avond', 'Avicii', 'Morgan Wallen', 'NF', 'Kygo'];

test('soundKey: Nederlands uitgesproken Engels klinkt hetzelfde', () => {
  assert.equal(soundKey('lekdij'), soundKey('legday'));
  assert.equal(soundKey('leg dei'), soundKey('Legday'));
  assert.equal(soundKey('a vichi'), soundKey('Avicii'));
  assert.notEqual(soundKey('rustig'), soundKey('legday'));
});

test('fixTranscript: hele zin klinkt als een hint', () => {
  assert.equal(fixTranscript(['lekdij'], hints), 'Legday');
  assert.equal(fixTranscript(['leg dij'], hints), 'Legday');
});

test('fixTranscript: alternatief dat precies een hint is gaat voor', () => {
  assert.equal(fixTranscript(['rustiger avond', 'rustige avond'], hints), 'Rustige avond');
});

test('fixTranscript: losse woorden in een zin verbeteren', () => {
  assert.equal(fixTranscript(['lekdij met veel bas'], hints), 'Legday met veel bas');
  assert.equal(fixTranscript(['begin met a vichi'], hints), 'begin met Avicii');
});

test('fixTranscript: laat de rest met rust', () => {
  assert.equal(fixTranscript(['iets rustigs voor het koken'], hints), 'iets rustigs voor het koken');
  assert.equal(fixTranscript(['en af'], hints), 'en af'); // korte hint "NF" niet op klank
  assert.equal(fixTranscript([], hints), '');
  assert.equal(fixTranscript(['lekdij'], []), 'lekdij');
});

test('speechHints: vibes eerst, uniek, begrensd', () => {
  const h = speechHints({
    quickVibes: ['Legday', 'Focus'],
    vibes: ['legday', 'Rustige avond'],
    planVibes: ['Focus'],
    artists: Array.from({ length: 200 }, (_, i) => `Artiest ${i}`),
  });
  assert.deepEqual(h.slice(0, 3), ['Legday', 'Focus', 'Rustige avond']);
  assert.equal(h.length, 43); // 3 vibes + max 40 artiesten
});
