import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueQueue } from './queue.ts';

const t = (id: string) => ({ id, name: id });

test('uniqueQueue: negen keer hetzelfde nummer (terugval van Spotify) wordt er één of geen', () => {
  const queue = [t('queen'), ...Array.from({ length: 9 }, () => t('collapse'))];
  assert.deepEqual(uniqueQueue(null, queue).map((x) => x.id), ['queen', 'collapse']);
});

test('uniqueQueue: het nummer dat nu speelt staat niet nog eens in de lijst', () => {
  assert.deepEqual(uniqueQueue({ id: 'collapse' }, [t('queen'), t('collapse'), t('collapse')]).map((x) => x.id), ['queen']);
});

test('uniqueQueue: volgorde blijft en een gewone wachtrij blijft ongewijzigd', () => {
  assert.deepEqual(uniqueQueue({ id: 'x' }, [t('a'), t('b'), t('c')]).map((x) => x.id), ['a', 'b', 'c']);
});
