// De DJ zelf: geschiedenis ophalen, verzoek naar GitHub, wachten op Claude, nummers opzoeken
// en de harde regels toepassen.
import * as sp from './spotify';
import * as gh from './github';
import { buildPool, buildRequest, bestMatch, parseAnswer, poolForClaude, type ClaudeItem, type ClaudeRef, type DjResponse } from '../logic/pool';
import { computeSignals, dislikedKeys } from '../logic/learning';
import { enforce, isFavorite, parseVibe, type EnforceContext } from '../logic/rules';
import { songKey } from '../logic/text';
import type { Learned, Plan, PlanItem, PoolTrack, Rules, Signals, Track } from '../logic/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type History = { pool: PoolTrack[]; recent: { id: string; at: number }[]; fetchedAt: number };

/** Haalt je luistergeschiedenis op bij Spotify. */
export async function fetchHistory(): Promise<History> {
  const [topShort, topMedium, topLong, recent, saved] = await Promise.all([
    sp.topTracks('short_term'),
    sp.topTracks('medium_term'),
    sp.topTracks('long_term'),
    sp.recentlyPlayed(),
    sp.savedTracks(200).catch(() => [] as Track[]),
  ]);
  return {
    pool: buildPool({ topShort, topMedium, topLong, recent, saved }),
    recent: recent.map((r) => ({ id: r.track.id, at: r.playedAt })),
    fetchedAt: Date.now(),
  };
}

export function signalsFor(learned: Learned, history: History | null, now = Date.now()): Signals {
  return computeSignals(learned, {
    known: new Set((history?.pool ?? []).map((t) => t.id)),
    recentPlays: history?.recent ?? [],
    now,
  });
}

export class DjError extends Error {
  kind: 'limiet' | 'token' | 'fout' | 'setup';
  resetAt: string | null;
  url?: string;
  constructor(kind: DjError['kind'], message: string, resetAt: string | null = null, url?: string) {
    super(message);
    this.kind = kind;
    this.resetAt = resetAt;
    this.url = url;
  }
}

export type DjInput = {
  vibeText: string;
  adjust?: string | null;
  previous?: Plan | null;
  rules: Rules;
  learned: Learned;
  history: History;
  repo: gh.RepoRef;
  model: string;
  favorite: Track | null;
  onStatus: (text: string) => void;
  cancel: { cancelled: boolean };
};

export type DjOutput = { plan: Plan; response: DjResponse; favorite: Track | null };

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Zoekt je Eurovisie-favoriet op Spotify (één keer; de app onthoudt hem). */
export async function resolveFavorite(rules: Rules, known: Track | null): Promise<Track | null> {
  const f = rules.eurovisionFavorite;
  if (known && songKey(known.name, known.artists) === songKey(f.title, [f.artist])) return known;
  const found = await sp.searchTracks(`track:${f.title} artist:${f.artist}`).catch(() => []);
  return bestMatch(found, f.title, f.artist) ?? bestMatch(await sp.searchTracks(`${f.title} ${f.artist}`).catch(() => []), f.title, f.artist);
}

async function resolveNew(item: ClaudeItem): Promise<Track | null> {
  const strict = await sp.searchTracks(`track:${item.title} artist:${item.artist}`).catch(() => []);
  const hit = bestMatch(strict, item.title, item.artist);
  if (hit) return hit;
  const loose = await sp.searchTracks(`${item.title} ${item.artist}`).catch(() => []);
  return bestMatch(loose, item.title, item.artist);
}

async function toPlanItems(list: ClaudeItem[], refs: Map<string, PoolTrack>, unresolved: string[]): Promise<PlanItem[]> {
  // Nieuwe nummers tegelijk opzoeken (max. 4 tegelijk), de volgorde blijft zoals Claude hem gaf.
  const slots: (PlanItem | null)[] = new Array(list.length).fill(null);
  const toFind: number[] = [];
  list.forEach((it, i) => {
    const known = it.ref ? refs.get(it.ref) : undefined;
    if (known) {
      const { tier: _t, plays: _p, ...track } = known;
      slots[i] = { track, style: it.style, isNew: false, energy: it.energy };
    } else if (it.title && it.artist) {
      toFind.push(i);
    }
  });
  let next = 0;
  const worker = async () => {
    while (next < toFind.length) {
      const i = toFind[next++];
      const it = list[i];
      const track = await resolveNew(it);
      if (track) slots[i] = { track, style: it.style, isNew: it.new || !it.ref, energy: it.energy };
      else unresolved.push(`${it.title} – ${it.artist}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return slots.filter((x): x is PlanItem => !!x);
}

/** Vraagt Claude (via GitHub Actions) om een voorstel en maakt er een gecontroleerde wachtrij van. */
export async function makePlan(input: DjInput): Promise<DjOutput> {
  const { rules, learned, history, repo, onStatus, cancel } = input;
  const now = Date.now();
  // Bij bijsturen kan de aanpassing zelf iets vragen ("begin met NF", "toch worship").
  const base = parseVibe(input.vibeText, rules);
  const extra = input.adjust ? parseVibe(input.adjust, rules) : null;
  const vibe = {
    ...base,
    artistStart: extra?.artistStart ?? base.artistStart,
    worship: base.worship || !!extra?.worship,
    eurovision: base.eurovision || !!extra?.eurovision,
  };
  const signals = signalsFor(learned, history, now);
  const ctx: EnforceContext = { rules, vibe, signals, now, dislikedKeys: dislikedKeys(signals, learned) };

  onStatus('Wat er nu speelt bekijken');
  const avoid: Track[] = [];
  try {
    const q = await sp.queue();
    if (q.current) avoid.push(q.current);
    avoid.push(...q.next.slice(0, 20));
  } catch {
    /* geen actief apparaat: prima */
  }

  const refs: ClaudeRef[] = poolForClaude(history.pool, ctx);
  const id = newId();
  const request = buildRequest({
    id,
    vibe,
    adjust: input.adjust ?? null,
    previous: input.previous ?? null,
    refs,
    rules,
    signals,
    learned,
    avoid,
    now: new Date(now),
    model: input.model,
  });

  onStatus('Verzoek naar GitHub sturen');
  await gh.ensureDataBranch(repo);
  await gh.putRequest(repo, id, request);
  // Staat er een warme DJ klaar? Dan pakt die het verzoek meteen op; anders een losse run starten.
  let standby = await gh.standbyState(repo).catch(() => null);
  let dispatched = false;
  if (!standby) {
    await gh.dispatch(repo, id);
    dispatched = true;
  }

  // Wachten op het antwoord (Claude Code draait in GitHub Actions).
  const started = Date.now();
  let response: DjResponse | null = null;
  let runUrl: string | undefined;
  let lastRunCheck = Date.now();
  while (!response) {
    if (cancel.cancelled) throw new DjError('fout', 'Gestopt');
    const secs = Math.round((Date.now() - started) / 1000);
    if (!dispatched) {
      onStatus(standby === 'klaar' ? `Claude stelt je wachtrij samen (${secs} s)` : `De DJ warmt op (${secs} s)`);
      // Vangnet: de warme DJ is net gestopt of doet het niet; dan alsnog een losse run.
      if (Date.now() - lastRunCheck > 20_000) {
        lastRunCheck = Date.now();
        standby = await gh.standbyState(repo).catch(() => standby);
        if (!standby || secs > 75) {
          await gh.dispatch(repo, id);
          dispatched = true;
        }
      }
    } else if (Date.now() - lastRunCheck > 8_000) {
      lastRunCheck = Date.now();
      const run = await gh.findRun(repo, id).catch(() => null);
      if (run) {
        runUrl = run.url;
        if (run.status === 'completed' && run.conclusion !== 'success') {
          // De workflow schrijft ook bij fouten een antwoord; kijk nog één keer.
          await sleep(3000);
          response = await gh.getResponse(repo, id).catch(() => null);
          if (!response) throw new DjError('fout', `De DJ-workflow is mislukt (${run.conclusion}).`, null, run.url);
          break;
        }
        onStatus(run.status === 'queued' ? `Wachten op een machine bij GitHub (${secs} s)` : `Claude stelt je wachtrij samen (${secs} s)`);
      } else {
        onStatus(`Workflow starten (${secs} s)`);
      }
    }
    if (secs > 13 * 60) throw new DjError('fout', 'Claude deed er te lang over (meer dan 13 minuten).', null, runUrl);
    await sleep(2000);
    response = await gh.getResponse(repo, id).catch(() => null);
  }

  if (response.status !== 'ok' || !response.answer) {
    const kind = response.status === 'ok' ? 'fout' : response.status;
    const e = new DjError(kind, response.message || 'Claude gaf geen antwoord.', response.resetAt, runUrl);
    (e as any).response = response;
    throw e;
  }
  const answer = parseAnswer(response.answer);
  if (!answer) throw new DjError('fout', 'Het antwoord van Claude was leeg of onleesbaar.', null, runUrl);

  onStatus('Nummers opzoeken in Spotify');
  const refMap = new Map(refs.map((r) => [r.ref, r.track]));
  const unresolved: string[] = [];
  const [items, spares, favorite] = await Promise.all([
    toPlanItems(answer.items, refMap, unresolved),
    toPlanItems(answer.spares, refMap, []),
    vibe.eurovision ? resolveFavorite(rules, input.favorite) : Promise.resolve(input.favorite),
  ]);
  const favInItems = items.some((it) => isFavorite(it.track, rules));
  if (vibe.eurovision && !favorite && !favInItems) unresolved.push(`${rules.eurovisionFavorite.title} – ${rules.eurovisionFavorite.artist} (favoriet)`);

  const checked = enforce(items, spares, { ...ctx, favorite });
  const plan: Plan = {
    id,
    vibe: vibe.text,
    title: answer.title || vibe.text,
    note: answer.note,
    createdAt: Date.now(),
    items: checked.items,
    spares: checked.spares,
    removed: checked.removed,
    unresolved,
  };
  return { plan, response, favorite };
}
