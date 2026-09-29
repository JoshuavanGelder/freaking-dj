// Live DJ: kijkt mee met wat er speelt en zet steeds maar één nummer vooruit in je Spotify-wachtrij.
// Na skips kiest hij meteen anders; bij veel skips of als de lijst bijna op is, stuurt Claude bij.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { useApp } from './store';
import * as sp from './services/spotify';
import { addToEnd, replaceQueue } from './services/player';
import { DjError, fetchHistory, makePlan } from './services/dj';
import { applyReplan, feedbackForClaude, observe, pickNext, startLive, takeNext, type LiveState } from './logic/live';
import { dislikedKeys } from './logic/learning';
import { parseVibe, rejectReason } from './logic/rules';
import { adjustKind, type AdjustKind } from './logic/adjust';
import type { Plan, PlanItem, Track } from './logic/types';

type LiveCtx = {
  live: LiveState | null;
  starting: string | null; // status tijdens het starten (wachten tot het nummer klaar is)
  replanning: boolean;
  error: string | null;
  start: (plan: Plan, mode: 'vervangen' | 'toevoegen', allowSkip: boolean) => Promise<boolean>;
  steer: (text: string) => void;
  stop: () => void;
  /** Info over een nummer uit de live-sessie (voor het scherm). */
  lookup: (id: string) => { track: Track; style: string; isNew: boolean } | null;
};

const Ctx = createContext<LiveCtx | null>(null);

export function useLive(): LiveCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLive buiten LiveProvider');
  return c;
}

const IDLE_STOP_MS = 30 * 60 * 1000; // niets gespeeld: na een half uur stopt Live DJ vanzelf

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { state, update, savePlan, signals } = useApp();
  const stateRef = useRef(state);
  stateRef.current = state;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const liveRef = useRef<LiveState | null>(state.live);
  const [starting, setStarting] = useState<string | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const replanBusy = useRef(false);
  const lastReplanTry = useRef(0);
  const idleSince = useRef<number | null>(null);

  // De store is leidend bij opstarten (Live DJ loopt door na herstart van de app).
  useEffect(() => {
    if (!liveRef.current && state.live) liveRef.current = state.live;
  }, [state.live]);

  /** Nieuwe toestand vastleggen. Alleen voortgang binnen hetzelfde nummer? Dan niet opslaan (scheelt schrijven). */
  const commit = useCallback(
    (next: LiveState | null) => {
      const prev = liveRef.current;
      liveRef.current = next;
      const same =
        !!prev &&
        !!next &&
        prev.status === next.status &&
        prev.queuedId === next.queuedId &&
        prev.planId === next.planId &&
        prev.note === next.note &&
        prev.upcoming.length === next.upcoming.length &&
        prev.played.length === next.played.length &&
        prev.current?.id === next.current?.id &&
        prev.lastReplanAt === next.lastReplanAt;
      if (!same) update((s) => ({ ...s, live: next }));
    },
    [update],
  );

  const lookup = useCallback((id: string) => {
    const L = liveRef.current;
    const find = (list: PlanItem[]) => list.find((x) => x.track.id === id);
    const hit = (L && find(L.upcoming)) || stateRef.current.plans.map((p) => find(p.items) ?? find(p.spares)).find(Boolean);
    if (hit) return { track: hit.track, style: hit.style, isNew: hit.isNew };
    const played = L?.played.find((p) => p.track.id === id);
    return played ? { track: played.track, style: played.style, isNew: played.isNew } : null;
  }, []);

  const allowed = useCallback((t: Track) => {
    const s = stateRef.current;
    const L = liveRef.current;
    const ctx = {
      rules: s.rules,
      vibe: parseVibe(L?.vibe ?? '', s.rules),
      signals: signalsRef.current,
      now: Date.now(),
      dislikedKeys: dislikedKeys(signalsRef.current, s.learned),
    };
    return !rejectReason(t, ctx);
  }, []);

  /** Claude laten bijsturen of aanvullen, op de achtergrond. */
  const replan = useCallback(
    async (adjust: string, manual: boolean, kind: AdjustKind = 'breed') => {
      const L = liveRef.current;
      if (!L || replanBusy.current) return;
      if (!manual && Date.now() - lastReplanTry.current < 60_000) return;
      replanBusy.current = true;
      lastReplanTry.current = Date.now();
      setReplanning(true);
      setError(null);
      commit({ ...L, lastReplanAt: L.played.length });
      try {
        const s = stateRef.current;
        let history = s.history;
        if (!history) {
          history = await fetchHistory();
          update((x) => ({ ...x, history }));
        }
        const base = s.plans.find((p) => p.id === L.planId);
        const previous: Plan = {
          id: L.planId,
          vibe: L.vibe,
          title: base?.title ?? L.vibe,
          note: '',
          createdAt: Date.now(),
          items: L.upcoming,
          spares: [],
          removed: [],
          unresolved: [],
        };
        const out = await makePlan({
          vibeText: L.vibe,
          adjust,
          previous,
          rules: s.rules,
          learned: s.learned,
          history,
          repo: { owner: s.settings.owner, repo: s.settings.repo },
          model: s.settings.model,
          favorite: s.favorite,
          onStatus: () => undefined,
          cancel: { cancelled: false },
          // Toevoegen/weghalen: de rest blijft staan; anders een frisse lijst van 15.
          count: kind === 'breed' ? 15 : undefined,
          adjustKind: kind,
          extraAvoid: L.played.map((p) => p.track),
        });
        savePlan({ ...out.plan, title: `Live: ${out.plan.title}` });
        update((x) => ({ ...x, lastResponse: out.response }));
        const cur = liveRef.current;
        if (cur && cur.status === 'actief') {
          const note = manual ? `Bijgestuurd: ${adjust.split('.')[0]}` : 'Claude heeft de rest aangepast aan wat je skipte en luisterde';
          const added = new Set(out.plan.addedIds ?? []);
          // Toegevoegde nummers vooraan, zodat ze snel langskomen; de rest in dezelfde volgorde.
          const items =
            kind === 'toevoegen'
              ? [...out.plan.items.filter((x) => added.has(x.track.id)), ...out.plan.items.filter((x) => !added.has(x.track.id))]
              : kind === 'weghalen'
                ? out.plan.items
                : [...out.plan.items, ...out.plan.spares];
          const text = manual && out.plan.change ? `${note} (${out.plan.change})` : note;
          commit(applyReplan(cur, items, out.plan.id, cur.played.length, text));
        }
      } catch (e: any) {
        const resp = e instanceof DjError ? (e as any).response : null;
        if (resp) update((x) => ({ ...x, lastResponse: resp }));
        setError(e instanceof DjError && e.kind === 'limiet' ? `Je Claude-limiet is op${e.resetAt ? ` (weer beschikbaar: ${e.resetAt})` : ''}; de DJ kiest verder zelf uit de lijst.` : `Bijsturen lukte niet: ${e?.message ?? e}`);
      } finally {
        replanBusy.current = false;
        setReplanning(false);
      }
    },
    [commit, update, savePlan],
  );

  /** Eén rondje: kijken wat er speelt en zo nodig het volgende nummer klaarzetten. */
  const tick = useCallback(async () => {
    const L0 = liveRef.current;
    if (!L0 || L0.status !== 'actief' || busy.current) return;
    busy.current = true;
    try {
      const pb = await sp.playback();
      const now = Date.now();
      if (!pb.item || !pb.isPlaying) {
        idleSince.current ??= now;
        if (now - idleSince.current > IDLE_STOP_MS) {
          commit(null);
          setError('Live DJ gestopt: er speelde een half uur niets.');
          return;
        }
      } else {
        idleSince.current = null;
      }
      const r = observe(L0, { id: pb.item?.id ?? null, progressMs: pb.progressMs, durationMs: pb.item?.durationMs ?? 0, isPlaying: pb.isPlaying, at: now }, lookup);
      commit(r.state);
      for (const a of r.actions) {
        if (a.type === 'queueNext') {
          const L = liveRef.current;
          if (!L || L.queuedId) continue;
          const pick = pickNext(L, pb.item ? { artists: pb.item.artists } : null, allowed);
          if (!pick) continue;
          const t = takeNext(L, pick.index, now, pick.why);
          commit(t.state); // eerst vastleggen, zodat er nooit twee tegelijk in de wachtrij gaan
          try {
            await sp.addToQueue(t.item.track.id, pb.device?.id);
          } catch (e: any) {
            const cur = liveRef.current;
            if (cur) commit({ ...cur, queuedId: null, upcoming: [t.item, ...cur.upcoming] });
            setError(`In de wachtrij zetten lukte niet: ${e?.message ?? e}`);
          }
        } else if (a.type === 'chainBroken') {
          const L = liveRef.current;
          if (!L?.queuedId) continue;
          const q = await sp.queue().catch(() => null);
          const still = q?.next.some((t) => t.id === L.queuedId);
          const cur = liveRef.current;
          if (cur) commit(still ? { ...cur, queuedAt: Date.now() } : { ...cur, queuedId: null });
        } else if (a.type === 'replan') {
          const L = liveRef.current;
          if (!L) continue;
          const fb = feedbackForClaude(L);
          replan(a.reason === 'aanvullen' ? `Vul de lijst aan met nummers die hierop aansluiten. ${fb}` : `Ik skip nu veel. ${fb}`, false);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      busy.current = false;
    }
  }, [commit, lookup, allowed, replan]);

  // De lus: elke 4 s als de app open is, elke 8 s op de achtergrond (de meeluister-dienst houdt de app wakker).
  const active = state.live?.status === 'actief';
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const loop = async () => {
      await tick();
      if (!alive) return;
      timer = setTimeout(loop, RNAppState.currentState === 'active' ? 4000 : 8000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, tick]);

  const start = useCallback(
    async (plan: Plan, mode: 'vervangen' | 'toevoegen', allowSkip: boolean) => {
      const first = plan.items[0];
      if (!first) return false;
      setError(null);
      setStarting('Live DJ starten');
      try {
        const cancel = { cancelled: false };
        if (mode === 'vervangen') await replaceQueue([first.track], stateRef.current.rules, { allowSkip }, setStarting, cancel);
        else await addToEnd([first.track], stateRef.current.rules, setStarting, cancel);
        commit(startLive(plan.id, plan.vibe, [...plan.items, ...plan.spares], first.track.id, Date.now()));
        return true;
      } catch (e: any) {
        setError(e?.message ?? String(e));
        return false;
      } finally {
        setStarting(null);
      }
    },
    [commit],
  );

  const steer = useCallback(
    (text: string) => {
      const L = liveRef.current;
      if (!L || !text.trim()) return;
      const kind = adjustKind(text).kind;
      // Bij toevoegen/weghalen geen sessie-feedback meesturen: dan blijft het bij precies wat je vroeg.
      replan(kind === 'breed' ? `${text.trim()}. ${feedbackForClaude(L)}` : text.trim(), true, kind);
    },
    [replan],
  );

  const stop = useCallback(() => {
    commit(null);
    setError(null);
  }, [commit]);

  const value = useMemo(
    () => ({ live: state.live, starting, replanning, error, start, steer, stop, lookup }),
    [state.live, starting, replanning, error, start, steer, stop, lookup],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
