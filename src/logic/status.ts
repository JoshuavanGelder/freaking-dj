// Is Claude beschikbaar? Twee bronnen: de uitkomst van de laatste DJ-run (limiet, token)
// en de openbare statuspagina van Anthropic.
import type { DjResponse } from './pool.ts';

export type ClaudeHealth = {
  level: 'ok' | 'let op' | 'storing' | 'onbekend';
  text: string;
};

type StatusSummary = {
  status?: { indicator?: string; description?: string };
  components?: { name?: string; status?: string }[];
  incidents?: { name?: string; status?: string; impact?: string }[];
};

const RELEVANT = /claude code|claude\.ai|claude api|api/i;

/** Leest https://status.claude.com/api/v2/summary.json. */
export function summarizeStatus(json: unknown): ClaudeHealth {
  if (!json || typeof json !== 'object') return { level: 'onbekend', text: 'Status van Claude onbekend.' };
  const s = json as StatusSummary;
  const bad = (s.components ?? []).filter((c) => c.name && RELEVANT.test(c.name) && c.status && c.status !== 'operational');
  const incidents = (s.incidents ?? []).filter((i) => i.status !== 'resolved' && i.status !== 'postmortem');
  if (bad.some((c) => c.status === 'major_outage' || c.status === 'partial_outage')) {
    return { level: 'storing', text: `Storing bij Claude: ${bad.map((c) => c.name).join(', ')}.` };
  }
  if (bad.length || incidents.length) {
    const what = incidents[0]?.name ?? bad.map((c) => c.name).join(', ');
    return { level: 'let op', text: `Claude heeft een verstoring: ${what}.` };
  }
  return { level: 'ok', text: 'Claude is beschikbaar.' };
}

/** Tekst voor de balk bovenin, op basis van de laatste run. */
export function responseHealth(r: DjResponse | null, now: number): ClaudeHealth | null {
  if (!r) return null;
  const age = now - Date.parse(r.finishedAt);
  if (r.status === 'limiet' && age < 12 * 3600 * 1000) {
    return { level: 'storing', text: r.resetAt ? `Je Claude-limiet is op (weer beschikbaar: ${r.resetAt}).` : 'Je Claude-limiet is op.' };
  }
  // Een oude tokenfout niet blijven tonen: het secret kan intussen vervangen zijn.
  if (r.status === 'token' && age < 30 * 60 * 1000) return { level: 'storing', text: 'Het Claude-token werkt niet meer. Maak een nieuw token (zie Instellingen).' };
  return null;
}
