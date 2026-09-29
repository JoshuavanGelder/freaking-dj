#!/usr/bin/env node
// Warme DJ: blijft ~10 minuten klaarstaan en pakt nieuwe verzoeken uit dj-data meteen op,
// zodat je niet elke keer wacht tot GitHub een machine heeft opgestart.
// Gebruik: node dj/standby.mjs <map-met-dj-data>
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleRequest } from './handle.mjs';
import { pendingIds } from './lib.mjs';

const dataDir = process.argv[2] ?? 'data';
const IDLE_MS = Number(process.env.DJ_IDLE_MINUTES ?? 10) * 60 * 1000;
const MAX_MS = 45 * 60 * 1000;
const started = Date.now();
let lastActivity = started;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...args) => execFileSync('git', args, { cwd: dataDir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

git('config', 'user.name', 'freaking-dj');
git('config', 'user.email', 'freaking-dj@users.noreply.github.com');

function listRequests() {
  const dir = join(dataDir, 'requests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.slice(0, -5);
      try {
        return { id, createdAt: JSON.parse(readFileSync(join(dir, f), 'utf8')).createdAt };
      } catch {
        return { id, createdAt: null };
      }
    });
}

function listResponses() {
  const dir = join(dataDir, 'responses');
  return new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
}

function sync() {
  git('fetch', '-q', '--depth=1', 'origin', 'dj-data');
  git('reset', '-q', '--hard', 'origin/dj-data');
}

function pushResponse(id) {
  git('add', `responses/${id}.json`);
  git('commit', '-q', '-m', `DJ-antwoord ${id}`);
  for (let i = 0; i < 6; i++) {
    try {
      git('push', '-q', 'origin', 'HEAD:dj-data');
      return;
    } catch {
      try {
        git('pull', '-q', '--rebase', '--depth=1', 'origin', 'dj-data');
      } catch {
        // Iemand anders (een losse run) zette hetzelfde antwoord al neer: dan is het goed.
        try {
          git('rebase', '--abort');
        } catch {}
        sync();
        if (listResponses().has(id)) return;
      }
    }
  }
  console.error(`Antwoord ${id} kon niet worden teruggezet`);
}

console.log(`Warme DJ staat klaar (stopt na ${IDLE_MS / 60000} min zonder verzoeken).`);
const done = new Set();
while (Date.now() - lastActivity < IDLE_MS && Date.now() - started < MAX_MS) {
  try {
    sync();
  } catch (e) {
    console.error(`Ophalen mislukt: ${e.message}`);
    await sleep(3000);
    continue;
  }
  const todo = pendingIds(listRequests(), listResponses(), Date.now()).filter((id) => !done.has(id));
  for (const id of todo) {
    done.add(id);
    console.log(`Verzoek ${id} oppakken`);
    await handleRequest(id, dataDir);
    try {
      pushResponse(id);
    } catch (e) {
      console.error(`Terugzetten mislukt: ${e.message}`);
    }
    lastActivity = Date.now();
  }
  await sleep(1500);
}
console.log('Warme DJ stopt.');
