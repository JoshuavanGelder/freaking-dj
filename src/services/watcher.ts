// Meeluisteren: de native dienst vangt Spotify-broadcasts op; hier lezen we ze in.
import { PermissionsAndroid, Platform } from 'react-native';
import * as W from 'spotify-watcher';
import type { RawEvent } from '../logic/learning';

export const watcherAvailable = W.available;

export function parseEvents(text: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === 'meta' && typeof o.id === 'string' && o.id) {
        out.push({ t: Number(o.t), type: 'meta', id: o.id, name: String(o.name ?? ''), artist: String(o.artist ?? ''), length: Number(o.length) || 0 });
      } else if (o.type === 'state') {
        out.push({ t: Number(o.t), type: 'state', playing: !!o.playing, pos: Number(o.pos) || 0 });
      }
    } catch {
      /* kapotte regel overslaan */
    }
  }
  return out;
}

export async function pullEvents(): Promise<RawEvent[]> {
  if (!W.available) return [];
  return parseEvents(await W.readAndClear());
}

export async function startWatcher(): Promise<boolean> {
  if (!W.available) return false;
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any).catch(() => undefined);
  }
  if (W.isRunning()) return true;
  return W.start();
}

export async function stopWatcher(): Promise<void> {
  if (W.available) await W.stop();
}

export const isWatching = () => W.isRunning();
export const lastEventAt = () => W.lastEventAt();
export const listen = (prompt: string) => W.listen(prompt);
export const openBatterySettings = () => W.openBatterySettings();
export const openSpotify = () => W.openSpotify();
export const speechAvailable = W.available;
