#!/usr/bin/env node
// Draait in GitHub Actions: leest een verzoek uit de dj-data-branch, laat Claude Code (met jouw
// abonnement via CLAUDE_CODE_OAUTH_TOKEN) de wachtrij samenstellen en schrijft het antwoord terug.
//
// Gebruik: node dj/run.mjs <request-id> <map-met-dj-data>
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, classify, parseCliOutput, renderRequest, validId } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [id, dataDir = 'data'] = process.argv.slice(2);
const started = Date.now();

let written = false;
function writeResponse(res) {
  if (written) return;
  written = true;
  mkdirSync(join(dataDir, 'responses'), { recursive: true });
  const body = { id, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, ...res };
  writeFileSync(join(dataDir, 'responses', `${id}.json`), JSON.stringify(body, null, 1));
  console.log(`Antwoord: ${body.status} – ${body.message}`);
}

if (!validId(id)) {
  console.error('Ongeldig verzoek-id');
  process.exit(1);
}

const reqPath = join(dataDir, 'requests', `${id}.json`);
if (!existsSync(reqPath)) {
  writeResponse({ status: 'fout', message: 'Verzoek niet gevonden in de dj-data-branch.', resetAt: null, answer: null });
  process.exit(0);
}
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  writeResponse({
    status: 'token',
    message: 'Er is nog geen Claude-token: zet het secret CLAUDE_CODE_OAUTH_TOKEN in de repo (maak het met "claude setup-token").',
    resetAt: null,
    answer: null,
  });
  process.exit(0);
}

const request = JSON.parse(readFileSync(reqPath, 'utf8'));
const model = MODELS.includes(request.model) ? request.model : 'sonnet';
const prompt = renderRequest(request);
const schema = readFileSync(join(here, 'schema.json'), 'utf8');

// Lege werkmap: Claude hoeft niets uit de repo te lezen (en de CLAUDE.md voor ontwikkelaars niet te zien).
const cwd = mkdtempSync(join(tmpdir(), 'dj-'));
const args = [
  '-p',
  'Build the queue for this request. Follow your instructions exactly and answer with the structured output.',
  '--output-format',
  'json',
  '--json-schema',
  schema,
  '--model',
  model,
  '--system-prompt-file',
  join(here, 'prompt.md'),
  '--tools',
  'WebSearch',
  '--allowedTools',
  'WebSearch',
  '--permission-mode',
  'dontAsk',
  '--max-turns',
  '12',
  '--no-session-persistence',
];

const child = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));
child.stdin.end(prompt);

const timer = setTimeout(() => child.kill('SIGINT'), 8 * 60 * 1000);
child.on('close', (code) => {
  clearTimeout(timer);
  const out = parseCliOutput(stdout);
  const res = classify(out, `${stdout}\n${stderr}`, code ?? 1);
  if (res.status !== 'ok') {
    console.error((stderr || stdout).slice(-2000));
    // Korte melding als annotation: die is via de API te lezen (de job-logs niet altijd).
    const said = String((out && out.result) || stderr || stdout || '').replace(/sk-ant-[A-Za-z0-9_-]+/g, '[token]');
    console.log(`::warning title=claude::${res.status}: ${said.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  writeResponse({ ...res, costUsd: out && typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null, model });
});
child.on('error', (err) => {
  clearTimeout(timer);
  writeResponse({ status: 'fout', message: `Claude Code kon niet starten: ${err.message}`, resetAt: null, answer: null });
});
