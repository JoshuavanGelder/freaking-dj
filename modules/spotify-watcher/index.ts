import { requireOptionalNativeModule } from 'expo-modules-core';

type Native = {
  isRunning(): boolean;
  lastEventAt(): number;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  readAndClear(): Promise<string>;
  listen(prompt: string): Promise<string | null>;
  openBatterySettings(): Promise<boolean>;
  openSpotify(): Promise<boolean>;
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

/** Spraakherkenning van Android in het Nederlands. null = afgebroken. */
export async function listen(prompt: string): Promise<string | null> {
  if (!N) return null;
  return N.listen(prompt);
}

export async function openBatterySettings(): Promise<boolean> {
  return N ? N.openBatterySettings() : false;
}

export async function openSpotify(): Promise<boolean> {
  return N ? N.openSpotify() : false;
}
