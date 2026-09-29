// Live DJ: de app zet steeds maar één nummer vooruit in Spotify en kiest het volgende pas als het
// vorige begint. Zo kan hij meteen reageren op skips. Pure logica, zodat we het kunnen testen.
import type { PlanItem, Track } from './types.ts';
import { norm, shareArtist } from './text.ts';

export type LivePlayed = { track: Track; style: string; isNew: boolean; outcome: 'full' | 'skip'; listenedMs: number; at: number };

export type LiveState = {
  planId: string;
  vibe: string;
  status: 'actief' | 'gepauzeerd';
  note: string; // korte uitleg voor het scherm ("Na 2 skips: minder EDM")
  upcoming: PlanItem[]; // waar de DJ uit kiest
  played: LivePlayed[]; // wat er in deze sessie van ons speelde
  queuedId: string | null; // ons nummer dat nu in de Spotify-wachtrij staat
  queuedAt: number;
  current: { id: string; progressMs: number; durationMs: number; ours: boolean; at: number } | null;
  lastReplanAt: number; // aantal gespeelde nummers bij de laatste bijsturing door Claude
  startedAt: number;
};

export type Observation = { id: string | null; progressMs: number; durationMs: number; isPlaying: boolean; at: number };

export type LiveAction = { type: 'queueNext' } | { type: 'replan'; reason: 'aanvullen' | 'skips' } | { type: 'chainBroken' };

export const QUICK_SKIP_MS = 30_000;
export const REFILL_BELOW = 5;

export function startLive(planId: string, vibe: string, items: PlanItem[], firstQueuedId: string | null, now: number): LiveState {
  return {
    planId,
    vibe,
    status: 'actief',
    note: '',
    upcoming: items.filter((it) => it.track.id !== firstQueuedId),
    played: [],
    queuedId: firstQueuedId,
    queuedAt: now,
    current: null,
    lastReplanAt: 0,
    startedAt: now,
  };
}

function isFullListen(progressMs: number, durationMs: number): boolean {
  return durationMs > 0 && (progressMs >= durationMs * 0.9 || durationMs - progressMs <= 15_000);
}

/**
 * Verwerkt wat er nu speelt. Geeft de nieuwe toestand en wat de app moet doen:
 * het volgende nummer in de wachtrij zetten, Claude laten bijsturen, of melden dat de keten brak.
 */
export function observe(
  s: LiveState,
  obs: Observation,
  lookup: (id: string) => { track: Track; style: string; isNew: boolean } | null,
): { state: LiveState; actions: LiveAction[] } {
  if (s.status !== 'actief') return { state: s, actions: [] };
  const actions: LiveAction[] = [];
  let state = { ...s };
  const cur = state.current;

  if (obs.id && (!cur || cur.id !== obs.id)) {
    // Ander nummer begonnen: het vorige afsluiten.
    if (cur && cur.ours) {
      const info = lookup(cur.id);
      if (info) {
        const full = isFullListen(cur.progressMs, cur.durationMs);
        state.played = [...state.played, { ...info, outcome: full ? 'full' : 'skip', listenedMs: cur.progressMs, at: obs.at }];
      }
    }
    const ours = obs.id === state.queuedId || !!lookup(obs.id);
    if (obs.id === state.queuedId) {
      state.queuedId = null;
    }
    state.current = { id: obs.id, progressMs: obs.progressMs, durationMs: obs.durationMs, ours, at: obs.at };
    if (!state.queuedId) {
      actions.push({ type: 'queueNext' });
    } else if (!ours && obs.at - state.queuedAt > 20_000) {
      // Er speelt iets anders terwijl ons nummer nog in de wachtrij zou moeten staan: even controleren.
      actions.push({ type: 'chainBroken' });
    }
  } else if (cur && obs.id === cur.id) {
    state.current = { ...cur, progressMs: Math.max(cur.progressMs, obs.progressMs), durationMs: obs.durationMs || cur.durationMs, at: obs.at };
    if (!state.queuedId && cur.ours) actions.push({ type: 'queueNext' });
  }

  // Claude laten bijsturen: bijna op, of twee snelle skips op rij.
  const sinceReplan = state.played.length - state.lastReplanAt;
  const last2 = state.played.slice(-2);
  const twoQuickSkips = last2.length === 2 && last2.every((p) => p.outcome === 'skip' && p.listenedMs < QUICK_SKIP_MS);
  if (state.upcoming.length < REFILL_BELOW) actions.push({ type: 'replan', reason: 'aanvullen' });
  else if (twoQuickSkips && sinceReplan >= 2) actions.push({ type: 'replan', reason: 'skips' });

  return { state, actions };
}

/** Trailing skips (de laatste gespeelde nummers die geskipt werden), nieuwste eerst. */
function recentSkips(played: LivePlayed[]): LivePlayed[] {
  const out: LivePlayed[] = [];
  for (let i = played.length - 1; i >= 0 && out.length < 3; i--) {
    if (played[i].outcome !== 'skip') break;
    out.push(played[i]);
  }
  return out;
}

/**
 * Kiest het volgende nummer uit `upcoming`. Standaard gewoon de volgorde van het voorstel, maar na skips:
 * niet dezelfde artiest, minder nieuwe nummers na een geskipt nieuw nummer, en na meerdere skips in
 * dezelfde stijl even een andere stijl. Na doorspringen naar een nummer: meer van die stijl.
 */
export function pickNext(
  s: LiveState,
  currentTrack: { artists: string[]; style?: string } | null,
  allowed: (t: Track) => boolean,
): { index: number; why: string } | null {
  const skips = recentSkips(s.played);
  const last = s.played[s.played.length - 1];
  const jumpedTo = last && last.outcome === 'full' && s.played.length >= 3 && s.played.slice(-3, -1).every((p) => p.outcome === 'skip') ? last : null;
  const skipStyles = new Map<string, number>();
  for (const k of skips) skipStyles.set(norm(k.style), (skipStyles.get(norm(k.style)) ?? 0) + 1);

  let best: { index: number; score: number; why: string } | null = null;
  let first: { index: number; why: string } | null = null; // wat zonder bijsturen de volgende was
  s.upcoming.forEach((it, i) => {
    if (!allowed(it.track)) return;
    if (s.played.some((p) => p.track.id === it.track.id)) return;
    let score = -i;
    let why = '';
    if (currentTrack && shareArtist(currentTrack.artists, it.track.artists)) score -= 100;
    for (const k of skips) {
      if (shareArtist(k.track.artists, it.track.artists)) {
        score -= 30;
        why = 'andere artiest na je skip';
      }
      if (k.isNew && it.isNew) {
        score -= 15;
        why = why || 'eerst weer een bekend nummer';
      }
    }
    const sameStyleSkips = skipStyles.get(norm(it.style)) ?? 0;
    if (sameStyleSkips >= 2) {
      score -= 25;
      why = why || `even geen ${it.style}`;
    } else if (sameStyleSkips === 1) {
      score -= 4;
    }
    if (jumpedTo && norm(jumpedTo.style) === norm(it.style)) {
      score += 12;
      why = why || `meer ${it.style}`;
    }
    if (!first) first = { index: i, why };
    if (!best || score > best.score) best = { index: i, score, why };
  });
  if (!best) return null;
  const b = best as { index: number; score: number; why: string };
  const f = first as { index: number; why: string } | null;
  // Uitleg: waarom niet het nummer dat eigenlijk aan de beurt was (of waarom juist deze).
  const why = f && b.index !== f.index ? f.why || b.why || 'aangepast aan je skips' : '';
  return { index: b.index, why };
}

/** Haalt het gekozen nummer uit de lijst en zet het als "in de wachtrij". */
export function takeNext(s: LiveState, index: number, now: number, why = ''): { state: LiveState; item: PlanItem } {
  const item = s.upcoming[index];
  const upcoming = s.upcoming.filter((_, i) => i !== index);
  return { state: { ...s, upcoming, queuedId: item.track.id, queuedAt: now, note: why ? `Aangepast: ${why}` : s.note }, item };
}

/** Samenvatting voor Claude: wat er in deze sessie gehoord en geskipt is. */
export function feedbackForClaude(s: LiveState): string {
  const full = s.played.filter((p) => p.outcome === 'full').slice(-10);
  const skipped = s.played.filter((p) => p.outcome === 'skip').slice(-10);
  const label = (p: LivePlayed) => `${p.track.name} – ${p.track.artists[0] ?? ''} (${p.style}${p.isNew ? ', nieuw' : ''})`;
  const parts: string[] = ['Live-sessie tot nu toe.'];
  if (full.length) parts.push(`Helemaal geluisterd: ${full.map(label).join('; ')}.`);
  if (skipped.length) parts.push(`Geskipt: ${skipped.map((p) => `${label(p)} na ${Math.round(p.listenedMs / 1000)} s`).join('; ')}.`);
  parts.push('Stem de rest hierop af: meer zoals wat helemaal geluisterd is, minder zoals wat geskipt is. Herhaal geen nummers die al gespeeld zijn.');
  return parts.join(' ');
}

/** Nieuwe lijst van Claude inpassen: alles wat al gespeeld is of in de wachtrij staat eruit. */
export function applyReplan(s: LiveState, items: PlanItem[], planId: string, played: number, note: string): LiveState {
  const skip = new Set([...s.played.map((p) => p.track.id), ...(s.queuedId ? [s.queuedId] : [])]);
  return { ...s, planId, upcoming: items.filter((it) => !skip.has(it.track.id)), lastReplanAt: played, note };
}
