// Eén DJ-verzoek afhandelen: verzoek lezen, Claude Code draaien (met je abonnement via
// CLAUDE_CODE_OAUTH_TOKEN), antwoord in responses/<id>.json schrijven.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, classify, parseCliOutput, renderRequest, validId } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function write(dataDir, id, started, res) {
  mkdirSync(join(dataDir, 'responses'), { recursive: true });
  const body = { id, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, ...res };
  writeFileSync(join(dataDir, 'responses', `${id}.json`), JSON.stringify(body, null, 1));
  console.log(`Antwoord ${id}: ${body.status} – ${body.message} (${Math.round(body.durationMs / 1000)} s)`);
  return body;
}

/** Handelt verzoek `id` af en schrijft het antwoord weg. Gooit nooit. */
export async function handleRequest(id, dataDir) {
  const started = Date.now();
  if (!validId(id)) throw new Error('Ongeldig verzoek-id');
  const reqPath = join(dataDir, 'requests', `${id}.json`);
  if (!existsSync(reqPath)) {
    return write(dataDir, id, started, { status: 'fout', message: 'Verzoek niet gevonden in de dj-data-branch.', resetAt: null, answer: null });
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return write(dataDir, id, started, {
      status: 'token',
      message: 'Er is nog geen Claude-token: zet het secret CLAUDE_CODE_OAUTH_TOKEN in de repo (maak het met scripts/claude-token.sh).',
      resetAt: null,
      answer: null,
    });
  }

  let request;
  try {
    request = JSON.parse(readFileSync(reqPath, 'utf8'));
  } catch {
    return write(dataDir, id, started, { status: 'fout', message: 'Het verzoek is geen geldige JSON.', resetAt: null, answer: null });
  }
  const model = MODELS.includes(request.model) ? request.model : 'sonnet';
  const prompt = renderRequest(request);
  const schema = readFileSync(join(here, 'schema.json'), 'utf8');

  // Lege werkmap: Claude hoeft niets uit de repo te lezen.
  const cwd = mkdtempSync(join(tmpdir(), 'dj-'));
  const args = [
    '-p',
    'Build the queue for this request. Follow your instructions exactly and answer with the structured output.',
    '--output-format', 'json',
    '--json-schema', schema,
    '--model', model,
    '--system-prompt-file', join(here, 'prompt.md'),
    '--tools', 'WebSearch',
    '--allowedTools', 'WebSearch',
    '--permission-mode', 'dontAsk',
    '--max-turns', '8',
    '--no-session-persistence',
  ];
  // Korter nadenken = sneller antwoord; voor een wachtrij is dat ruim genoeg.
  if (model !== 'haiku') args.push('--effort', 'low');

  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      resolve(write(dataDir, id, started, res));
    };
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGINT'), 6 * 60 * 1000);
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
      finish({ ...res, costUsd: out && typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null, model });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ status: 'fout', message: `Claude Code kon niet starten: ${err.message}`, resetAt: null, answer: null });
    });
  });
}
