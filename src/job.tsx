// Lopende klussen (Claude om een wachtrij vragen, nummers in Spotify zetten) en de Claude-status.
// Staat boven de schermen, zodat een verzoek doorloopt als je van scherm wisselt.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { useApp } from './store';
import * as sp from './services/spotify';
import * as gh from './services/github';
import { DjError, fetchHistory, makePlan, type History } from './services/dj';
import { addToEnd, replaceQueue, PlayerError } from './services/player';
import { fetchClaudeStatus } from './services/status';
import { responseHealth, type ClaudeHealth } from './logic/status';
import type { Plan } from './logic/types';

export type Job = { kind: 'dj' | 'queue'; status: string; startedAt: number; vibe?: string };
export type JobError = { title: string; message: string; url?: string; kind?: string };

type JobCtx = {
  job: Job | null;
  error: JobError | null;
  clearError: () => void;
  health: ClaudeHealth;
  refreshHealth: () => void;
  requestPlan: (vibeText: string, opts?: { adjust?: string; previous?: Plan }) => Promise<Plan | null>;
  sendToSpotify: (plan: Plan, mode: 'toevoegen' | 'vervangen', allowSkip: boolean) => Promise<boolean>;
  refreshHistory: () => Promise<History | null>;
  cancel: () => void;
  /** Warme DJ: 'klaar' = staat klaar, 'opwarmen' = wordt gestart, null = uit. */
  warm: gh.StandbyState;
  warmUp: () => void;
};

const Ctx = createContext<JobCtx | null>(null);

export function useJob(): JobCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useJob buiten JobProvider');
  return c;
}

const HISTORY_MAX_AGE = 6 * 3600 * 1000;

export function JobProvider({ children }: { children: React.ReactNode }) {
  const { state, update, savePlan } = useApp();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<JobError | null>(null);
  const [statusPage, setStatusPage] = useState<ClaudeHealth>({ level: 'onbekend', text: 'Status van Claude wordt opgehaald…' });
  const cancelRef = useRef({ cancelled: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshHealth = useCallback(() => {
    fetchClaudeStatus().then(setStatusPage);
  }, []);

  // Warme DJ: zodra je de app opent staat er binnen een halve minuut een machine klaar,
  // zodat je verzoek niet hoeft te wachten tot GitHub er een opstart.
  const [warm, setWarm] = useState<gh.StandbyState>(null);
  const warmBusy = useRef(false);
  const lastWarm = useRef(0);
  /** start = zo nodig een warme DJ starten; anders alleen de status bijwerken. */
  const checkWarm = useCallback(async (start: boolean) => {
    if (warmBusy.current) return;
    if (start && Date.now() - lastWarm.current < 30_000) return;
    warmBusy.current = true;
    try {
      if (!(await gh.getToken())) return;
      const repo = { owner: stateRef.current.settings.owner, repo: stateRef.current.settings.repo };
      let st = await gh.standbyState(repo);
      if (!st && start && stateRef.current.settings.warmDj) {
        lastWarm.current = Date.now();
        await gh.startStandby(repo);
        st = 'opwarmen';
      }
      setWarm(st);
    } catch {
      setWarm(null);
    } finally {
      warmBusy.current = false;
    }
  }, []);
  const warmUp = useCallback(() => {
    checkWarm(true);
  }, [checkWarm]);

  useEffect(() => {
    warmUp();
    const sub = RNAppState.addEventListener('change', (st) => {
      if (st === 'active') warmUp();
    });
    // Alleen de status bijwerken; opnieuw starten gebeurt bij openen en na een verzoek.
    const timer = setInterval(() => {
      if (RNAppState.currentState === 'active') checkWarm(false);
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [warmUp, checkWarm]);

  // Luistergeschiedenis alvast ophalen, zodat een verzoek daar niet op hoeft te wachten.
  useEffect(() => {
    const h = stateRef.current.history;
    if (h && Date.now() - h.fetchedAt < HISTORY_MAX_AGE) return;
    sp.isConnected().then((ok) => {
      if (!ok) return;
      fetchHistory()
        .then((hist) => update((x) => ({ ...x, history: hist })))
        .catch(() => undefined);
    });
  }, [update]);

  useEffect(() => {
    refreshHealth();
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') refreshHealth();
    });
    const timer = setInterval(refreshHealth, 5 * 60 * 1000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refreshHealth]);

  const health = useMemo<ClaudeHealth>(() => {
    const fromRun = responseHealth(state.lastResponse, Date.now());
    return fromRun ?? statusPage;
  }, [state.lastResponse, statusPage]);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await fetchHistory();
      update((s) => ({ ...s, history: h }));
      return h;
    } catch (e: any) {
      setError({ title: 'Geschiedenis ophalen mislukt', message: e?.message ?? String(e) });
      return null;
    }
  }, [update]);

  const requestPlan = useCallback(
    async (vibeText: string, opts: { adjust?: string; previous?: Plan } = {}) => {
      const s = stateRef.current;
      setError(null);
      if (!(await sp.isConnected())) {
        setError({ title: 'Spotify is niet gekoppeld', message: 'Koppel Spotify eerst in Instellingen.' });
        return null;
      }
      if (!(await gh.getToken())) {
        setError({ title: 'GitHub is niet ingesteld', message: 'Zet je GitHub-token in Instellingen; via GitHub draait Claude met je abonnement.' });
        return null;
      }
      cancelRef.current = { cancelled: false };
      const cancel = cancelRef.current;
      setJob({ kind: 'dj', status: 'Je luistergeschiedenis bekijken', startedAt: Date.now(), vibe: opts.adjust ? `${vibeText} · ${opts.adjust}` : vibeText });
      try {
        let history = s.history;
        if (!history || Date.now() - history.fetchedAt > HISTORY_MAX_AGE) {
          history = await fetchHistory();
          update((x) => ({ ...x, history }));
        }
        const out = await makePlan({
          vibeText,
          adjust: opts.adjust ?? null,
          previous: opts.previous ?? null,
          rules: s.rules,
          learned: s.learned,
          history,
          repo: { owner: s.settings.owner, repo: s.settings.repo },
          model: s.settings.model,
          favorite: s.favorite,
          onStatus: (status) => setJob((j) => (j ? { ...j, status } : j)),
          cancel,
        });
        savePlan(out.plan);
        update((x) => ({
          ...x,
          lastResponse: out.response,
          favorite: out.favorite ?? x.favorite,
          vibes: opts.adjust ? x.vibes : [vibeText, ...x.vibes.filter((v) => v.toLowerCase() !== vibeText.toLowerCase())].slice(0, 8),
        }));
        return out.plan;
      } catch (e: any) {
        if (cancel.cancelled) return null;
        if (e instanceof DjError) {
          const resp = (e as any).response;
          if (resp) update((x) => ({ ...x, lastResponse: resp }));
          const title = e.kind === 'limiet' ? 'Je Claude-limiet is op' : e.kind === 'token' ? 'Claude-token werkt niet' : 'Claude kon geen wachtrij maken';
          const message = e.kind === 'limiet' && e.resetAt ? `${e.message} Weer beschikbaar: ${e.resetAt}.` : e.message;
          setError({ title, message, url: e.url, kind: e.kind });
        } else {
          setError({ title: 'Er ging iets mis', message: e?.message ?? String(e) });
        }
        return null;
      } finally {
        setJob(null);
      }
    },
    [update, savePlan],
  );

  const sendToSpotify = useCallback(async (plan: Plan, mode: 'toevoegen' | 'vervangen', allowSkip: boolean) => {
    const s = stateRef.current;
    setError(null);
    cancelRef.current = { cancelled: false };
    const cancel = cancelRef.current;
    setJob({ kind: 'queue', status: mode === 'vervangen' ? 'Wachtrij vervangen' : 'Toevoegen aan je wachtrij', startedAt: Date.now() });
    const progress = (status: string) => setJob((j) => (j ? { ...j, status } : j));
    try {
      const tracks = plan.items.map((i) => i.track);
      if (mode === 'vervangen') await replaceQueue(tracks, s.rules, { allowSkip }, progress, cancel);
      else await addToEnd(tracks, s.rules, progress, cancel);
      return !cancel.cancelled;
    } catch (e: any) {
      const msg = e instanceof PlayerError ? e.message : e?.message ?? String(e);
      setError({ title: 'Wachtrij zetten mislukt', message: msg });
      return false;
    } finally {
      setJob(null);
    }
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current.cancelled = true;
    setJob(null);
  }, []);

  const value = useMemo(
    () => ({ job, error, clearError: () => setError(null), health, refreshHealth, requestPlan, sendToSpotify, refreshHistory, cancel, warm, warmUp }),
    [job, error, health, refreshHealth, requestPlan, sendToSpotify, refreshHistory, cancel, warm, warmUp],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
