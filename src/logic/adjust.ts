// Bijsturen zonder alles om te gooien. "Doe er X bij" = alleen toevoegen, "haal X weg" = alleen weghalen;
// dan blijft de rest van de lijst gegarandeerd staan, in dezelfde volgorde. Alleen bij brede opdrachten
// ("rustiger", "harder", "meer NF") mag Claude de lijst echt herschikken.
import type { PlanItem } from './types.ts';
import { songKey } from './text.ts';

export type AdjustKind = 'toevoegen' | 'weghalen' | 'breed';

const ADD_RE =
  /\b(voeg|doe|zet|gooi|stop|plak)\b.*\b(toe|bij|erbij|erin|ertussen|tussen)\b|\b(erbij|ertussen|toevoegen)\b|^\s*(ook|plus|\+)\s|\bnog\s+(een|1|één|twee|drie|\d+)\s+(nummer|nummers|liedje|liedjes|track|tracks)\b/i;
const REMOVE_RE = /\b(haal|gooi|doe|zet)\b.*\b(weg|eruit|uit)\b|\b(weghalen|verwijder|verwijderen|zonder)\b|^\s*geen\s|\bniet\s+meer\b/i;

const WORD_NUM: Record<string, number> = { een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5 };

/** Wat voor bijsturing is dit, en om hoeveel nummers gaat het (bij toevoegen)? */
export function adjustKind(text: string): { kind: AdjustKind; count: number } {
  const t = text.trim();
  const m = t.match(/\b(\d+|een|één|twee|drie|vier|vijf)\s+(nummer|nummers|liedje|liedjes|track|tracks)\b/i);
  const n = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1].toLowerCase()] ?? 1) : 1;
  // Weghalen eerst: "gooi Firestone eruit" is weghalen, "gooi er Firestone bij" is toevoegen.
  if (REMOVE_RE.test(t) && !/\b(bij|erbij|toe)\b/i.test(t)) return { kind: 'weghalen', count: 0 };
  if (ADD_RE.test(t)) return { kind: 'toevoegen', count: Math.max(1, Math.min(10, n)) };
  return { kind: 'breed', count: 0 };
}

const keyOf = (it: PlanItem) => it.track.id;
const songOf = (it: PlanItem) => songKey(it.track.name, it.track.artists);

/**
 * Voegt Claudes nieuwe lijst samen met de vorige:
 * - toevoegen: alle vorige nummers blijven, in dezelfde volgorde; nieuwe komen op de plek die Claude koos;
 * - weghalen: alleen wat Claude wegliet gaat eruit; de rest blijft in dezelfde volgorde;
 * - breed: Claudes lijst zoals hij is.
 */
export function mergeAdjusted(
  previous: PlanItem[],
  proposed: PlanItem[],
  kind: AdjustKind,
): { items: PlanItem[]; added: PlanItem[]; removed: PlanItem[] } {
  const prevIds = new Set(previous.map(keyOf));
  const prevSongs = new Set(previous.map(songOf));
  const inPrev = (it: PlanItem) => prevIds.has(keyOf(it)) || prevSongs.has(songOf(it));
  if (kind === 'breed') {
    const propIds = new Set(proposed.map(keyOf));
    const propSongs = new Set(proposed.map(songOf));
    return {
      items: proposed,
      added: proposed.filter((it) => !inPrev(it)),
      removed: previous.filter((it) => !propIds.has(keyOf(it)) && !propSongs.has(songOf(it))),
    };
  }

  // Nieuwe nummers hangen we achter het vorige nummer dat Claude er direct voor zette (het "anker").
  const after = new Map<string | null, PlanItem[]>(); // anker-id (null = helemaal vooraan) -> nieuwe nummers
  const keptIds = new Set<string>();
  const keptSongs = new Set<string>();
  const seenNew = new Set<string>();
  let anchor: string | null = null;
  for (const it of proposed) {
    if (inPrev(it)) {
      const prevItem = previous.find((p) => keyOf(p) === keyOf(it) || songOf(p) === songOf(it))!;
      keptIds.add(keyOf(prevItem));
      keptSongs.add(songOf(prevItem));
      anchor = keyOf(prevItem);
    } else if (!seenNew.has(songOf(it))) {
      seenNew.add(songOf(it));
      after.set(anchor, [...(after.get(anchor) ?? []), it]);
    }
  }

  const base = kind === 'toevoegen' ? previous : previous.filter((p) => keptIds.has(keyOf(p)) || keptSongs.has(songOf(p)));
  // Bij weghalen kan het anker zelf weg zijn: schuif nieuwe nummers dan door naar het vorige nummer dat blijft.
  const baseIds = new Set(base.map(keyOf));
  const items: PlanItem[] = [...(after.get(null) ?? [])];
  let pendingFromRemoved: PlanItem[] = [];
  for (const p of previous) {
    const extra = after.get(keyOf(p)) ?? [];
    if (baseIds.has(keyOf(p))) {
      items.push(p, ...pendingFromRemoved, ...extra);
      pendingFromRemoved = [];
    } else {
      pendingFromRemoved.push(...extra);
    }
  }
  items.push(...pendingFromRemoved);
  const added = items.filter((it) => !inPrev(it));
  const removed = previous.filter((p) => !baseIds.has(keyOf(p)));
  return { items, added, removed };
}

/** Korte uitleg voor het scherm: "1 nummer toegevoegd", "2 weg, 2 nieuw". */
export function describeChange(added: number, removed: number): string {
  const parts: string[] = [];
  if (added) parts.push(added === 1 ? '1 nummer toegevoegd' : `${added} nummers toegevoegd`);
  if (removed) parts.push(removed === 1 ? '1 nummer weggehaald' : `${removed} nummers weggehaald`);
  return parts.join(', ') || 'niets veranderd';
}
