// Beslissingen rond de wachtrij en apparaten, los van de Spotify-aanroepen (zodat we ze kunnen testen).
import { norm } from './text.ts';

export type Device = {
  id: string | null;
  name: string;
  type: string; // "Smartphone", "Computer", "AVR", "Speaker" ...
  isActive: boolean;
  isRestricted: boolean;
  supportsVolume: boolean;
  volume: number | null;
};

export type DeviceChoice =
  | { ok: true; device: Device; start: boolean } // start = nog niets actief, we starten op je pc
  | { ok: false; message: string };

/**
 * Welk apparaat? Het apparaat dat al speelt (nooit uit zichzelf overzetten).
 * Is er niets actief, dan je pc — nooit de receiver.
 */
export function pickDevice(devices: Device[], pcName: string, never: string[]): DeviceChoice {
  const active = devices.find((d) => d.isActive);
  if (active) {
    if (active.isRestricted) return { ok: false, message: `${active.name} laat zich niet op afstand bedienen.` };
    return { ok: true, device: active, start: false };
  }
  const blocked = (d: Device) =>
    d.type.toUpperCase() === 'AVR' || never.some((n) => norm(d.name).includes(norm(n)));
  const pc = devices.find((d) => norm(d.name) === norm(pcName)) ?? devices.find((d) => norm(d.name).includes(norm(pcName)));
  if (pc && !blocked(pc) && !pc.isRestricted) return { ok: true, device: pc, start: true };
  return {
    ok: false,
    message: `Er speelt nu niets en je pc (${pcName}) is niet te vinden in Spotify. Start Spotify op je telefoon of pc en probeer het opnieuw.`,
  };
}

/** Bij "toevoegen": alleen wat nog niet in de wachtrij staat of nu speelt, in volgorde. */
export function idsToAdd(planIds: string[], queueIds: string[], currentId: string | null): string[] {
  const skip = new Set(queueIds);
  if (currentId) skip.add(currentId);
  const seen = new Set<string>();
  return planIds.filter((id) => {
    if (skip.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Na het starten van het eerste nieuwe nummer: hoeveel oude (zelf toegevoegde) nummers staan
 * er nog vóór in de wachtrij? Die moeten eruit; Spotify laat de wachtrij niet leegmaken,
 * dus die slaan we (met het volume even op 0) over.
 */
export function leadingOld(queueIdsNow: string[], oldQueueIds: string[], newIds: string[]): number {
  const old = new Set(oldQueueIds);
  const fresh = new Set(newIds);
  let n = 0;
  for (const id of queueIdsNow) {
    if (fresh.has(id)) break;
    if (!old.has(id)) break;
    n++;
  }
  return n;
}

/** Hoe lang nog tot het huidige nummer klaar is (ms). */
export function msUntilEnd(progressMs: number, durationMs: number): number {
  return Math.max(0, durationMs - progressMs);
}

/** Staan er nog nummers in de wachtrij die niet van ons voorstel zijn? Dan vraagt de app: toevoegen of vervangen. */
export function hasOldQueue(queueIds: string[], planIds: string[]): boolean {
  const plan = new Set(planIds);
  return queueIds.some((id) => !plan.has(id));
}

/**
 * Wachtrij zoals we die tonen: zonder het nummer dat nu speelt en zonder herhalingen. Spotify geeft bij een lege
 * wachtrij soms steeds hetzelfde nummer terug (de automatische terugval) dat er niet echt in staat.
 * Alleen voor het scherm; de logica rond toevoegen en vervangen blijft de ruwe lijst gebruiken.
 */
export function uniqueQueue<T extends { id: string }>(current: { id: string } | null, next: T[]): T[] {
  const seen = new Set<string>();
  if (current) seen.add(current.id);
  return next.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}
