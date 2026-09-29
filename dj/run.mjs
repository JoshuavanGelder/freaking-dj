#!/usr/bin/env node
// Eén verzoek afhandelen (gewone run): node dj/run.mjs <request-id> <map-met-dj-data>
import { handleRequest } from './handle.mjs';
import { validId } from './lib.mjs';

const [id, dataDir = 'data'] = process.argv.slice(2);
if (!validId(id)) {
  console.error('Ongeldig verzoek-id');
  process.exit(1);
}
await handleRequest(id, dataDir);
