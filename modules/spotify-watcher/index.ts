import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  isRunning(): boolean;
  lastEventAt(): number;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  readAndClear(): Promise<string>;
  listen(prompt: string, hints: string[]): Promise<string[] | null>;
  openBatterySettings(): Promise<boolean>;
  openSpotify(): Promise<boolean>;
  authSet(clientId: string, refresh: string, access: string, expiresAt: number): Promise<boolean>;
  authClear(): Promise<boolean>;
  hasAuth(): boolean;
  accessToken(force: boolean): Promise<string>;
  liveStart(queuedId: string, candidatesJson: string): Promise<boolean>;
  liveSetCandidates(candidatesJson: string): Promise<boolean>;
  liveSetQueued(id: string, metaJson: string): Promise<boolean>;
  liveStop(): Promise<boolean>;
  liveState(): Promise<string>;
};

const N = requireOptionalNativeModule<Native>('SpotifyWatcher');

/** True als de native module in deze build zit (niet in Expo Go / tests). */
export const available = !!N;

export function isRunning(): boolean {
  return N ? N.isRunning() : false;
}

/** Laatste keer dat er een Spotify-broadcast binnenkwam (ms), 0 = nooit. */
export function lastEventAt(): number {
  return N ? N.lastEventAt() : 0;
}

export async function start(): Promise<boolean> {
  return N ? N.start() : false;
}

export async function stop(): Promise<boolean> {
  return N ? N.stop() : false;
}

/** Leest alle opgevangen gebeurtenissen (JSON-regels) en maakt het bestand leeg. */
export async function readAndClear(): Promise<string> {
  return N ? N.readAndClear() : '';
}

/** Spraakherkenning van Android in het Nederlands, met hints (Android 13+). Alternatieven, beste eerst; [] = afgebroken. */
export async function listen(prompt: string, hints: string[] = []): Promise<string[]> {
  if (!N) return [];
  const r = await N.listen(prompt, hints);
  return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [];
}

export async function openBatterySettings(): Promise<boolean> {
  return N ? N.openBatterySettings() : false;
}

export async function openSpotify(): Promise<boolean> {
  return N ? N.openSpotify() : false;
}

// ---------- Spotify-token (native is eigenaar) ----------

export async function authSet(clientId: string, refresh: string, access: string, expiresAt: number): Promise<void> {
  if (N) await N.authSet(clientId, refresh, access, expiresAt);
}

export async function authClear(): Promise<void> {
  if (N) await N.authClear();
}

export function hasAuth(): boolean {
  return N ? N.hasAuth() : false;
}

export async function accessToken(force = false): Promise<string> {
  if (!N) throw new Error('Geen native module');
  return N.accessToken(force);
}

// ---------- Live DJ in de dienst ----------

export type LiveCandidate = { id: string; artists: string[]; isNew: boolean; style: string; durationMs: number };
export type NativeLiveState = {
  active: boolean;
  queuedId: string;
  history: { id: string; outcome: 'full' | 'skip'; listenedMs: number; at: number }[];
  error: string;
};

export async function liveStart(queuedId: string, candidates: LiveCandidate[], firstMeta?: LiveCandidate): Promise<boolean> {
  if (!N) return false;
  await N.liveStart(queuedId, JSON.stringify(candidates));
  if (firstMeta) await N.liveSetQueued(queuedId, JSON.stringify(firstMeta));
  return true;
}

export async function liveSetCandidates(candidates: LiveCandidate[]): Promise<void> {
  if (N) await N.liveSetCandidates(JSON.stringify(candidates));
}

export async function liveSetQueued(id: string, meta: LiveCandidate | null): Promise<void> {
  if (N) await N.liveSetQueued(id, JSON.stringify(meta ?? {}));
}

export async function liveStop(): Promise<void> {
  if (N) await N.liveStop();
}

export async function liveState(): Promise<NativeLiveState | null> {
  if (!N) return null;
  try {
    return JSON.parse(await N.liveState()) as NativeLiveState;
  } catch {
    return null;
  }
}
