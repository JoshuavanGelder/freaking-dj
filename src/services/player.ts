// De wachtrij in Spotify zetten: achteraan toevoegen, of de oude wachtrij echt vervangen
// zonder het nummer te onderbreken waar je naar luistert.
import * as sp from './spotify';
import { idsToAdd, leadingOld, msUntilEnd, pickDevice, type Device } from '../logic/queue';
import type { Rules, Track } from '../logic/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Snapshot = {
  playback: sp.Playback;
  current: Track | null;
  queue: Track[];
  devices: Device[];
};

export async function snapshot(): Promise<Snapshot> {
  const [playback, q, devices] = await Promise.all([sp.playback(), sp.queue().catch(() => ({ current: null, next: [] })), sp.devices()]);
  return { playback, current: q.current ?? playback.item, queue: q.next, devices };
}

export type Progress = (text: string) => void;
export type Cancel = { cancelled: boolean };

export class PlayerError extends Error {}

function chooseDevice(snap: Snapshot, rules: Rules) {
  const choice = pickDevice(snap.devices, rules.pcDevice, rules.neverDevices);
  if (!choice.ok) throw new PlayerError(choice.message);
  return choice;
}

async function addEach(ids: string[], deviceId: string | null, progress: Progress, cancel?: Cancel) {
  let n = 0;
  for (const id of ids) {
    if (cancel?.cancelled) break;
    await sp.addToQueue(id, deviceId);
    n++;
    if (n % 5 === 0 || n === ids.length) progress(`Toegevoegd: ${n} van ${ids.length}`);
    await sleep(150);
  }
  return n;
}

/** "Voeg toe aan mijn wachtrij": alleen achteraan, niets wat er al in staat. */
export async function addToEnd(tracks: Track[], rules: Rules, progress: Progress, cancel?: Cancel): Promise<number> {
  const snap = await snapshot();
  const choice = chooseDevice(snap, rules);
  const ids = idsToAdd(tracks.map((t) => t.id), snap.queue.map((t) => t.id), snap.current?.id ?? null);
  if (!ids.length) return 0;
  if (choice.start || !snap.playback.item) {
    // Er speelt niets: begin met het eerste nummer (als los nummer, geen playlist), de rest in de wachtrij.
    progress(`Starten op ${choice.device.name}`);
    await sp.playTracks([ids[0]], choice.device.id);
    await sleep(600);
    return 1 + (await addEach(ids.slice(1), choice.device.id, progress, cancel));
  }
  progress(`Toevoegen op ${choice.device.name}`);
  return addEach(ids, choice.device.id, progress, cancel);
}

/**
 * Vervangen: wacht tot het huidige nummer klaar is (tenzij skippen mag), start dan het eerste nieuwe
 * nummer, haalt achtergebleven oude nummers weg (Spotify kan de wachtrij niet leegmaken, dus die
 * slaan we met het volume heel even op 0 over) en zet de rest erachter.
 */
export async function replaceQueue(
  tracks: Track[],
  rules: Rules,
  opts: { allowSkip: boolean },
  progress: Progress,
  cancel: Cancel,
): Promise<number> {
  if (!tracks.length) return 0;
  const snap = await snapshot();
  const choice = chooseDevice(snap, rules);
  const device = choice.device;
  const deviceId = device.id;
  const oldIds = snap.queue.map((t) => t.id);
  const newIds = tracks.map((t) => t.id);
  const volume = device.supportsVolume ? device.volume : null;
  let muted = false;
  const mute = async () => {
    if (volume == null || muted || volume === 0) return;
    await sp.setVolume(0, deviceId);
    muted = true;
  };
  const unmute = async () => {
    if (!muted || volume == null) return;
    await sp.setVolume(volume, deviceId);
    muted = false;
  };

  try {
    // 1. Wachten tot het huidige nummer klaar is.
    const current = snap.playback.item;
    if (!opts.allowSkip && current && snap.playback.isPlaying && !choice.start) {
      let pb = snap.playback;
      for (;;) {
        if (cancel.cancelled) return 0;
        if (!pb.item || pb.item.id !== current.id) break; // volgende nummer begonnen
        const left = msUntilEnd(pb.progressMs, pb.item.durationMs);
        const secs = Math.ceil(left / 1000);
        progress(pb.isPlaying ? `Wacht tot "${current.name}" klaar is (nog ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})` : `"${current.name}" staat op pauze; ik wacht tot het nummer klaar is`);
        if (pb.isPlaying && left <= 700 && oldIds.length) await mute(); // de laatste fractie is stil: meteen dempen voorkomt dat het volgende oude nummer hoorbaar start
        const wait = !pb.isPlaying ? 3000 : left > 12_000 ? Math.min(left - 8000, 20_000) : left > 3000 ? left - 2500 : 350;
        await sleep(wait);
        pb = await sp.playback();
      }
    }
    if (cancel.cancelled) return 0;

    // 2. Eerste nieuwe nummer starten (los nummer, geen playlist).
    progress('Nieuwe wachtrij starten');
    if (oldIds.length) await mute();
    await sp.playTracks([newIds[0]], deviceId);

    // 3. Achtergebleven oude nummers overslaan.
    for (let round = 0; round < 3 && oldIds.length; round++) {
      await sleep(800);
      const q = await sp.queue();
      const k = leadingOld(q.next.map((t) => t.id), oldIds, newIds);
      if (!k) break;
      progress(`Oude wachtrij opruimen (${k})`);
      for (let i = 0; i < k; i++) {
        await sp.next(deviceId);
        await sleep(300);
      }
      await sp.playTracks([newIds[0]], deviceId);
    }
  } finally {
    await unmute().catch(() => undefined);
  }

  // 4. De rest achter het eerste nummer.
  await sleep(500);
  const added = await addEach(newIds.slice(1), deviceId, progress, cancel);
  return 1 + added;
}
