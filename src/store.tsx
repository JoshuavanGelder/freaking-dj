// Alle app-gegevens op één plek, bewaard in AsyncStorage. Geheimen (tokens) staan apart in SecureStore.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_RULES } from './logic/rules';
import { EMPTY_LEARNED, ingest, prunePlays, tagPlays, type OpenSeg, type RawEvent } from './logic/learning';
import type { DjResponse } from './logic/pool';
import type { Learned, Plan, Rules, Signals, Track } from './logic/types';
import { signalsFor, type History } from './services/dj';

export type Model = 'sonnet' | 'opus' | 'haiku';

export type Settings = {
  owner: string;
  repo: string;
  spotifyClientId: string;
  model: Model;
  watcher: boolean;
  warmDj: boolean; // warme DJ starten als je de app opent
};

export type AppState = {
  version: 1;
  rules: Rules;
  learned: Learned;
  watchOpen: OpenSeg | null;
  plans: Plan[]; // nieuwste eerst
  history: History | null;
  settings: Settings;
  lastResponse: DjResponse | null;
  vibes: string[]; // laatst gebruikte vibes
  favorite: Track | null; // Eurovisie-favoriet, opgezocht op Spotify
};

export const DEFAULT_SETTINGS: Settings = {
  owner: 'JoshuavanGelder',
  repo: 'freaking-dj',
  spotifyClientId: '',
  model: 'sonnet',
  watcher: true,
  warmDj: true,
};

const EMPTY: AppState = {
  version: 1,
  rules: DEFAULT_RULES,
  learned: EMPTY_LEARNED,
  watchOpen: null,
  plans: [],
  history: null,
  settings: DEFAULT_SETTINGS,
  lastResponse: null,
  vibes: [],
  favorite: null,
};

const KEY = 'fdj-state-v1';

type Ctx = {
  state: AppState;
  loaded: boolean;
  signals: Signals;
  update: (fn: (s: AppState) => AppState) => void;
  /** Verwerkt opgevangen Spotify-gebeurtenissen (van de meeluister-dienst). */
  addEvents: (events: RawEvent[]) => void;
  savePlan: (plan: Plan) => void;
  decide: (trackId: string, decision: 'bevestigd' | 'afgewezen' | null) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp buiten AppProvider');
  return c;
}

function merge(saved: Partial<AppState> | null): AppState {
  if (!saved) return EMPTY;
  return {
    ...EMPTY,
    ...saved,
    rules: { ...DEFAULT_RULES, ...(saved.rules ?? {}) },
    learned: { ...EMPTY_LEARNED, ...(saved.learned ?? {}) },
    settings: {
      ...DEFAULT_SETTINGS,
      ...(saved.settings ?? {}),
      // Haiku bleek in de praktijk juist trager: terug naar Sonnet.
      model: saved.settings?.model === 'opus' ? 'opus' : 'sonnet',
    },
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => setState(merge(raw ? JSON.parse(raw) : null)))
      .catch(() => setState(EMPTY))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
    }, 300);
  }, [state, loaded]);

  const update = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), []);

  const addEvents = useCallback((events: RawEvent[]) => {
    if (!events.length) return;
    setState((s) => {
      const r = ingest(s.watchOpen, events);
      const plans = s.plans.map((p) => ({
        vibe: p.vibe,
        createdAt: p.createdAt,
        ids: p.items.map((i) => i.track.id),
        newIds: p.items.filter((i) => i.isNew).map((i) => i.track.id),
      }));
      const tagged = tagPlays(r.plays, plans);
      const meta = { ...s.learned.meta };
      for (const p of tagged) meta[p.id] = { name: p.name, artist: p.artist };
      return {
        ...s,
        watchOpen: r.open,
        learned: { ...s.learned, meta, plays: prunePlays([...s.learned.plays, ...tagged], Date.now()) },
      };
    });
  }, []);

  const savePlan = useCallback((plan: Plan) => {
    setState((s) => {
      const meta = { ...s.learned.meta };
      for (const it of plan.items) meta[it.track.id] = { name: it.track.name, artist: it.track.artists.join(', ') };
      return {
        ...s,
        plans: [plan, ...s.plans.filter((p) => p.id !== plan.id)].slice(0, 15),
        learned: { ...s.learned, meta },
      };
    });
  }, []);

  const decide = useCallback((trackId: string, decision: 'bevestigd' | 'afgewezen' | null) => {
    setState((s) => {
      const decisions = { ...s.learned.decisions };
      if (decision) decisions[trackId] = decision;
      else delete decisions[trackId];
      return { ...s, learned: { ...s.learned, decisions, asked: { ...s.learned.asked, [trackId]: Date.now() } } };
    });
  }, []);

  const signals = useMemo(() => signalsFor(state.learned, state.history), [state.learned, state.history]);

  const value = useMemo(
    () => ({ state, loaded, signals, update, addEvents, savePlan, decide }),
    [state, loaded, signals, update, addEvents, savePlan, decide],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
