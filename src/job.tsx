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
    () => ({ job, error, clearError: () => setError(null), health, refreshHealth, requestPlan, sendToSpotify, refreshHistory, cancel }),
    [job, error, health, refreshHealth, requestPlan, sendToSpotify, refreshHistory, cancel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
