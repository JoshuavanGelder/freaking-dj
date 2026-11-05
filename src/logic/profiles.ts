// Vaste profielen voor de vibes die Joshua het meest gebruikt: Standaard, Gym en Worship.
// Alles wat daar niet onder valt is "overig" en werkt zoals altijd (vrije vibe-tekst).
// Een profiel bepaalt: extra uitleg voor Claude, hoe vaak een nieuw nummer, en (bij Gym) een strenge
// energie-ondergrens die de app zelf controleert. Daarnaast telt geschiedenis per profiel:
// "Legday" en "Gym" leren van elkaar.
import type { Learned, VibeProfile } from './types.ts';
import { norm } from './text.ts';

const GYM_RE = /\b(gym|legday|leg day|legs?|sportschool|sporten|sport|workout|work out|training|trainen|fitness|krachttraining|push ?day|pull ?day|upper ?body|lower ?body|cardio|hardlopen|running|lift(ing)?|pump|beast ?mode)\b/;
const WORSHIP_RE = /\b(worship|christelijk\w*|aanbidding|lofprijs\w*|opwekking|gospel|kerk\w*|praise)\b/;
const STANDARD_RE = /^(standaard|standard|normaal|default|gewoon|mijn muziek|mijn mix|daily|dagelijks|alles)$/;

/** Welk profiel hoort bij deze vibe-tekst? */
export function profileOf(text: string | undefined | null): VibeProfile {
  const n = norm(text ?? '');
  if (!n) return 'overig';
  if (WORSHIP_RE.test(n)) return 'worship';
  if (GYM_RE.test(n)) return 'gym';
  // "begin met X" achter standaard mag ook: "standaard, begin met Morgan Wallen".
  const head = n.replace(/\b(begin|start|open|beginnen)\s+(met|with)\b.*$/, '').trim();
  if (STANDARD_RE.test(head)) return 'standaard';
  return 'overig';
}

/** Groep voor het leren: het vaste profiel, of de vibe-tekst zelf bij overige vibes. */
export function vibeGroup(text: string | undefined | null): string {
  const p = profileOf(text);
  if (p !== 'overig') return p;
  return norm(text ?? '') || 'zonder vibe';
}

const GROUP_LABELS: Record<string, string> = { standaard: 'Standaard', gym: 'Gym', worship: 'Worship' };

/** Leesbare naam van een groep ("gym" -> "Gym", "coding" -> "Coding"). */
export function vibeGroupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group.charAt(0).toUpperCase() + group.slice(1);
}

/** Horen twee vibes bij elkaar voor het leren? Zelfde tekst, of hetzelfde vaste profiel. */
export function sameVibe(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = norm(a ?? '');
  const nb = norm(b ?? '');
  if (na && na === nb) return true;
  const pa = profileOf(a);
  return pa !== 'overig' && pa === profileOf(b);
}

/** Uitleg per profiel voor Claude (Engels, net als de systeemprompt). */
export const PROFILE_NOTES: Record<VibeProfile, string[]> = {
  standaard: [
    'Profile STANDAARD: all the music Joshua likes, except worship. Not one genre or mood: his whole taste in one mix (current favourites, older favourites, and the genres he plays in other vibes, gym bangers included).',
    'Build it from the whole pool, weighted towards `nu` tracks, recent plays and tracks marked `here` (fully played before in any non-worship vibe). Mix his genres and styles across the queue.',
    'New tracks: popular songs that fit one of his genres. No worship / Christian music at all.',
  ],
  gym: [
    'Profile GYM: Joshua lifts hard to this and is VERY picky. It must NOT feel like his everyday mix with a few loud songs added.',
    'Only real workout bangers: high tempo (roughly 120+ BPM or a heavy half-time beat), a big hook or drop, aggressive, driving or anthemic. Think hard rap/hip-hop (NF, Eminem-style), rock and metal riffs, EDM/hardstyle/bass drops, and huge power anthems.',
    'Never in a gym queue: ballads, slow or mid-tempo songs, acoustic, chill, sad, soft pop, country ballads, worship. Also not his favourites if they are not workout songs (being a favourite is NOT enough here).',
    'Every track energy 4 or 5; at most the first 1–2 tracks may be a 4 as warm-up. Do not make an energy wave here: keep it high the whole session. The app removes anything below energy 4 unless it is marked `here`, so rate energy honestly.',
    'Tracks marked `here` were fully played in earlier gym sessions: those are proven gym tracks, use them first and most. Tracks listed under "Skipped in this vibe" are not gym tracks for him.',
    'New tracks only when you are sure they hit hard and match the proven gym tracks (same artists or sound). Fewer new tracks than usual.',
  ],
  worship: [
    'Profile WORSHIP: Joshua\'s worship / Christian music. Worship artists are allowed and expected here.',
    'Only worship / Christian songs: his worship artists and other worship/CCM tracks from the pool, plus tracks marked `here` (fully played in earlier worship sessions). No secular songs, even if they are favourites.',
    'Mix big anthems and calmer, reflective songs in a gentle wave. New tracks: well-known worship songs from the same artists or scene (Elevation, Hillsong, Brandon Lake, Bethel, Maverick City, Phil Wickham and the like).',
  ],
  overig: [],
};

/** Hoeveel bekende nummers per nieuw nummer, per profiel. */
export function newEveryFor(profile: VibeProfile, base: number): number {
  if (profile === 'gym') return Math.max(base, 6);
  return base;
}

/** Laagste energie die in een gym-wachtrij mag (tenzij het nummer al bewezen is in de gym). */
export const GYM_MIN_ENERGY = 4;

export type VibeStat = { full: number; skips: number };

/**
 * Per nummer: hoe vaak helemaal gehoord en hoe vaak geskipt bij deze vibe (of hetzelfde profiel; bij Standaard alles behalve worship).
 * Alleen plays van de laatste 60 dagen staan nog in `learned.plays`.
 */
export function vibeStats(learned: Learned, vibeText: string): Map<string, VibeStat> {
  const out = new Map<string, VibeStat>();
  // Standaard = alles wat je leuk vindt behalve worship: daar telt wat je bij elke andere vibe helemaal afluisterde.
  const everything = profileOf(vibeText) === 'standaard';
  for (const p of learned.plays) {
    if (!p.vibe) continue;
    if (everything ? profileOf(p.vibe) === 'worship' : !sameVibe(p.vibe, vibeText)) continue;
    const s = out.get(p.id) ?? { full: 0, skips: 0 };
    if (p.outcome === 'full') s.full++;
    else s.skips++;
    out.set(p.id, s);
  }
  return out;
}

/** Bewezen bij deze vibe: minstens één keer helemaal gehoord en vaker gehoord dan geskipt. */
export function provenIds(stats: Map<string, VibeStat>): Set<string> {
  const ids = new Set<string>();
  for (const [id, s] of stats) if (s.full >= 1 && s.full > s.skips) ids.add(id);
  return ids;
}
