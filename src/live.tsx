// Live DJ: kijkt mee met wat er speelt en zet steeds maar één nummer vooruit in je Spotify-wachtrij.
// Na skips kiest hij meteen anders; bij veel skips of als de lijst bijna op is, stuurt Claude bij.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { useApp } from './store';
import * as sp from './services/spotify';
import { addToEnd, replaceQueue } from './services/player';
import { DjError, fetchHistory, makePlan } from './services/dj';
import { applyReplan, feedbackForClaude, isUsed, missingQueued, observe, pickNext, reconcileNative, startLive, takeNext, usedSet, type LiveState } from './logic/live';
import * as W from 'spotify-watcher';
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
  /** Controleert of het klaargezette nummer nog in de Spotify-wachtrij staat en zet het anders terug. null = Live DJ loopt niet. */
  resync: () => Promise<{ level: 'ok' | 'info'; text: string } | null>;
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
/** Dienst had het volgende nummer al klaar moeten zetten; na zoveel ms doet de app het zelf. */
const NATIVE_GRACE_MS = 8_000;
/** Reload-knop: zo lang wachten voor een tweede blik op Spotify's wachtrij voordat we iets opnieuw toevoegen. */
const RECHECK_MS = 2_000;
const RESTRICTED = 'Beperkt apparaat';

/** Uitleg als Spotify een apparaat niet laat bedienen (Restricted device: geen wachtrij via de Web API). */
function restrictedMessage(name?: string | null): string {
  return `${RESTRICTED}: ${name ?? 'dit apparaat'} laat geen wachtrij toe via Spotify, dus Live DJ kan hier niets klaarzetten. Speel via je telefoon of pc (bij een speaker: via Bluetooth of kabel); Live DJ gaat vanzelf verder zodra het apparaat wisselt.`;
}

function toCandidate(it: PlanItem): W.LiveCandidate {
  return { id: it.track.id, artists: it.track.artists, isNew: it.isNew, style: it.style, durationMs: it.track.durationMs };
}

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
  const pendingSince = useRef<number | null>(null);
  const restrictedDev = useRef<string | null>(null); // apparaat dat geen wachtrij-commando's aanneemt
  const native = W.available;

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

  /** Nummers die nu spelen of klaarstaan (met naam, zodat ook een andere versie herkend wordt). */
  const inUse = useCallback(
    (L: LiveState): Track[] => [L.current?.id, L.queuedId].map((id) => (id ? lookup(id)?.track : null)).filter((t): t is Track => !!t),
    [lookup],
  );

  /** Wat de dienst mag kiezen: de rest van de lijst, al gecontroleerd op je regels en zonder wat al gespeeld is of klaarstaat. */
  const candidates = useCallback(
    (L: LiveState): W.LiveCandidate[] => {
      const used = usedSet(L, inUse(L));
      return L.upcoming.filter((it) => allowed(it.track) && !isUsed(used, it.track)).slice(0, 40).map(toCandidate);
    },
    [allowed, inUse],
  );

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
          extraAvoid: [...L.played.map((p) => p.track), ...inUse(L)],
          excludeUsed: true,
        });
        savePlan({ ...out.plan, title: `Live: ${out.plan.title}` });
        update((x) => ({ ...x, lastResponse: out.response }));
        let cur = liveRef.current;
        if (cur && cur.status === 'actief') {
          // Claude deed er even over: eerst bijwerken wat de dienst en Spotify intussen deden, zodat er
          // niets terugkomt dat al speelt, klaarstaat of net gespeeld is.
          if (native) {
            const ns = await W.liveState().catch(() => null);
            if (ns?.active) cur = reconcileNative(cur, ns, lookup, Date.now());
          }
          const q = await sp.queue().catch(() => null);
          const inSpotify = q ? [...(q.current ? [q.current] : []), ...q.next] : [];
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
          commit(applyReplan(cur, items, out.plan.id, cur.played.length, text, [...inUse(cur), ...inSpotify]));
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
    [commit, update, savePlan, inUse, lookup, native],
  );

  /** Eén rondje: kijken wat er speelt en zo nodig het volgende nummer klaarzetten. */
  const tick = useCallback(async () => {
    const L0 = liveRef.current;
    if (!L0 || L0.status !== 'actief' || busy.current) return;
    busy.current = true;
    try {
      const pb = await sp.playback();
      const now = Date.now();
      const devKey = pb.device?.id ?? pb.device?.name ?? null;
      if (restrictedDev.current && devKey !== restrictedDev.current) {
        // Ander apparaat: opnieuw proberen en de uitleg weghalen.
        restrictedDev.current = null;
        setError((e) => (e?.startsWith(RESTRICTED) ? null : e));
      }
      if (!pb.item || !pb.isPlaying) {
        idleSince.current ??= now;
        if (now - idleSince.current > IDLE_STOP_MS) {
          commit(null);
          W.liveStop().catch(() => undefined);
          setError('Live DJ gestopt: er speelde een half uur niets.');
          return;
        }
      } else {
        idleSince.current = null;
      }
      let L1 = L0;
      if (native) {
        const ns = await W.liveState();
        if (ns) {
          if (!ns.active) {
            if (ns.error.includes('gestopt')) {
              commit(null);
              setError(ns.error);
              return;
            }
            // Dienst draait (nog) niet mee, bv. na een update: opnieuw starten.
            await W.liveStart(L0.queuedId ?? '', candidates(L0));
          } else {
            L1 = reconcileNative(L0, ns, lookup, now);
            if (ns.error && !ns.error.includes('gestopt') && !restrictedDev.current) setError(ns.error);
          }
        }
      }
      const r = observe(L1, { id: pb.item?.id ?? null, progressMs: pb.progressMs, durationMs: pb.item?.durationMs ?? 0, isPlaying: pb.isPlaying, at: now }, lookup);
      commit(r.state);
      for (const a of r.actions) {
        if (a.type === 'queueNext') {
          const L = liveRef.current;
          if (!L || L.queuedId) {
            pendingSince.current = null;
            continue;
          }
          // Restricted device: Spotify laat hier geen wachtrij toe. Niet steeds opnieuw proberen, wel uitleggen.
          if (pb.device?.isRestricted || (devKey && restrictedDev.current === devKey)) {
            restrictedDev.current = devKey;
            pendingSince.current = null;
            setError(restrictedMessage(pb.device?.name));
            continue;
          }
          // Met de dienst: die zet het volgende nummer binnen een seconde klaar. Alleen als dat niet
          // gebeurt (Spotify stuurde geen seintje, of een fout) doet de app het zelf.
          if (native) {
            pendingSince.current ??= now;
            if (now - pendingSince.current < NATIVE_GRACE_MS) continue;
          }
          pendingSince.current = null;
          const pick = pickNext(L, pb.item ? { artists: pb.item.artists, name: pb.item.name } : null, allowed);
          if (!pick) continue;
          const t = takeNext(L, pick.index, now, pick.why);
          commit(t.state); // eerst vastleggen, zodat er nooit twee tegelijk in de wachtrij gaan
          try {
            await sp.addToQueue(t.item.track.id, pb.device?.id);
            if (native) await W.liveSetQueued(t.item.track.id, toCandidate(t.item));
          } catch (e: any) {
            const cur = liveRef.current;
            if (cur) commit({ ...cur, queuedId: null, upcoming: [t.item, ...cur.upcoming] });
            if (/restricted/i.test(e?.message ?? '')) {
              restrictedDev.current = devKey;
              setError(restrictedMessage(pb.device?.name));
            } else {
              setError(`In de wachtrij zetten lukte niet: ${e?.message ?? e}`);
            }
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
  }, [commit, lookup, allowed, replan, candidates, native]);

  // De dienst steeds de actuele lijst geven (na bijsturen, na een keuze).
  const upcomingKey = state.live ? `${state.live.planId}|${state.live.upcoming.length}|${state.live.upcoming[0]?.track.id ?? ''}|${state.live.queuedId ?? ''}` : '';
  useEffect(() => {
    const L = liveRef.current;
    if (!native || !L || L.status !== 'actief') return;
    W.liveSetCandidates(candidates(L)).catch(() => undefined);
  }, [upcomingKey, native, candidates]);

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
        const L = startLive(plan.id, plan.vibe, [...plan.items, ...plan.spares], first.track.id, Date.now());
        commit(L);
        if (native) await W.liveStart(first.track.id, candidates(L), toCandidate(first));
        return true;
      } catch (e: any) {
        setError(e?.message ?? String(e));
        return false;
      } finally {
        setStarting(null);
      }
    },
    [commit, candidates, native],
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

  /** Reload-knop: staat wat wij klaarzetten nog in de Spotify-wachtrij? Zo niet (bv. je maakte de wachtrij leeg), dan opnieuw toevoegen. */
  const resync = useCallback(async () => {
    const L0 = liveRef.current;
    if (!L0 || L0.status !== 'actief') return null;
    if (busy.current) return { level: 'info' as const, text: 'Live DJ is net bezig met de wachtrij; probeer het zo nog eens.' };
    busy.current = true; // de lus wacht zolang, zodat er niet twee keer hetzelfde nummer wordt toegevoegd
    try {
      // Spotify's wachtrij loopt na een skip of nummerwissel even achter: ziet het er kwijt uit, dan
      // eerst nog een keer kijken voordat we iets opnieuw toevoegen (anders staat het er dubbel in).
      let q = await sp.queue();
      let pb = await sp.playback();
      let L = liveRef.current;
      if (!L || L.status !== 'actief') return null;
      let id = missingQueued(L, q.next.map((t) => t.id), q.current?.id ?? pb.item?.id ?? null, Date.now());
      if (id) {
        await new Promise((r) => setTimeout(r, RECHECK_MS));
        [q, pb] = await Promise.all([sp.queue(), sp.playback()]);
        L = liveRef.current;
        if (!L || L.status !== 'actief') return null;
        id = missingQueued(L, q.next.map((t) => t.id), q.current?.id ?? pb.item?.id ?? null, Date.now());
      }
      if (!id) return { level: 'ok' as const, text: L.queuedId ? 'De wachtrij klopt: het volgende nummer staat klaar.' : 'Live DJ zet zo het volgende nummer klaar.' };
      const devKey = pb.device?.id ?? pb.device?.name ?? null;
      if (pb.device?.isRestricted || (devKey && restrictedDev.current === devKey)) {
        restrictedDev.current = devKey;
        setError(restrictedMessage(pb.device?.name));
        return null;
      }
      const info = lookup(id);
      try {
        await sp.addToQueue(id, pb.device?.id);
      } catch (e: any) {
        if (/restricted/i.test(e?.message ?? '')) {
          restrictedDev.current = devKey;
          setError(restrictedMessage(pb.device?.name));
          return null;
        }
        throw e;
      }
      if (native && info) await W.liveSetQueued(id, { id, artists: info.track.artists, isNew: info.isNew, style: info.style, durationMs: info.track.durationMs });
      const cur = liveRef.current;
      if (cur) commit({ ...cur, queuedAt: Date.now() });
      setError(null);
      return { level: 'ok' as const, text: `${info ? `"${info.track.name}"` : 'Het klaargezette nummer'} stond niet meer in je wachtrij en is opnieuw toegevoegd.` };
    } finally {
      busy.current = false;
    }
  }, [commit, lookup, native]);

  const stop = useCallback(() => {
    commit(null);
    setError(null);
    W.liveStop().catch(() => undefined);
  }, [commit]);

  const value = useMemo(
    () => ({ live: state.live, starting, replanning, error, start, steer, stop, resync, lookup }),
    [state.live, starting, replanning, error, start, steer, stop, resync, lookup],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
