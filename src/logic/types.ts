// Gedeelde types voor de DJ-logica. Alleen types: geen runtime-code, zodat de node-tests simpel blijven.

/** Een nummer zoals de app het van Spotify kent. */
export type Track = {
  id: string; // Spotify-track-id (22 tekens)
  name: string;
  artists: string[];
  durationMs: number;
  image?: string; // albumhoes (klein)
};

/** Uit de luistergeschiedenis: 'nu' = huidige favoriet, 'ouder' = om te herontdekken. */
export type PoolTrack = Track & { tier: 'nu' | 'ouder'; plays: number };

/** Eén nummer in een voorstel. */
export type PlanItem = {
  track: Track;
  style: string; // stijlgroep, bv. "Country-rock"
  isNew: boolean; // (nieuw) = niet uit je geschiedenis
  energy: number; // 1 (rustig) t/m 5 (knallen)
};

export type Removed = { title: string; artist: string; reason: string };

/** Een voorstel voor een wachtrij. */
export type Plan = {
  id: string;
  vibe: string;
  title: string;
  note: string;
  createdAt: number;
  items: PlanItem[];
  spares: PlanItem[]; // reserves om te wisselen
  removed: Removed[]; // wat de app eruit haalde (blocklist enz.)
  unresolved: string[]; // nieuwe nummers die niet op Spotify gevonden zijn
  parentId?: string; // bij bijsturen: de vorige versie
  change?: string; // bij bijsturen: "1 nummer toegevoegd"
  addedIds?: string[]; // bij bijsturen: welke nummers er nieuw bij kwamen
};

/** Vaste profielen: Standaard, Gym en Worship. Alles daarbuiten is "overig" (vrije vibe). */
export type VibeProfile = 'standaard' | 'gym' | 'worship' | 'overig';

/** Wat de app over de vibe begrijpt. */
export type VibeInfo = {
  text: string;
  profile?: VibeProfile; // ontbreekt = overig
  artistStart: string | null; // "begin met Morgan Wallen" -> "Morgan Wallen"
  worship: boolean; // om worship gevraagd
  eurovision: boolean;
};

/** Regels en voorkeuren die je in de app kunt aanpassen. */
export type Rules = {
  blockedArtists: string[];
  worshipArtists: string[];
  eurovisionFavorite: { title: string; artist: string };
  customRules: string[]; // vrije regels die Claude meekrijgt
  taste: string[]; // smaak per stemming, als startpunt voor Claude
  quickVibes: string[];
  count: number; // ~25 nummers
  newEvery: number; // 1 nieuw nummer per zoveel bekende
  pcDevice: string; // naam van je pc in Spotify
  neverDevices: string[]; // nooit uit zichzelf naar deze apparaten (Denon)
};

// ---------- leren van skips ----------

/** Eén keer afspelen van een nummer, opgebouwd uit de Spotify-broadcasts. */
export type Play = {
  id: string;
  name: string;
  artist: string;
  lengthMs: number;
  start: number; // ms sinds 1970
  listenedMs: number;
  outcome: 'full' | 'skip';
  vibe?: string; // vibe van de wachtrij waar het nummer uit kwam
  fromPlanNew?: boolean; // stond als (nieuw) in een voorstel
};

/** Je eigen antwoord op een vermoeden. Gaat altijd voor. */
export type Decision = 'bevestigd' | 'afgewezen';

export type TrackMeta = { name: string; artist: string };

export type Learned = {
  plays: Play[]; // laatste weken
  decisions: Record<string, Decision>; // trackId -> jouw antwoord
  asked: Record<string, number>; // trackId -> wanneer gevraagd (één keer per gok)
  meta: Record<string, TrackMeta>; // namen bij track-ids (voor het overzicht)
  manualRest: Record<string, number>; // trackId -> rust tot (zelf ingesteld)
  unrest?: Record<string, number>; // trackId -> wanneer je de rust opgeheven hebt
  /** "Geen zin in" zelf gewist: `${trackId}|${vibeGroup}` -> tot wanneer skips niet meer tellen. */
  notNowCleared?: Record<string, number>;
  /** "Geen zin in" zelf toegevoegd: trackId -> vibes (blijft staan tot je het weghaalt). */
  notNowManual?: Record<string, { vibe: string; at: number }[]>;
};

export type Suspicion = { id: string; name: string; artist: string; reason: string; question: string };

/** Eén "geen zin in": bij welke vibe, wanneer, en of je hem zelf toevoegde (dan verloopt hij niet). */
export type NotNowEntry = { vibe: string; hour: number; at: number; manual?: boolean };

export type Signals = {
  /** Te vaak gedraaid: trackId -> rust tot. */
  resting: Record<string, number>;
  /** Geen zin in (per vibe): trackId -> vibes waarin je hem los skipte. */
  notNow: Record<string, NotNowEntry[]>;
  /** Vermoedens van "niet leuk" (nog niet bevestigd). */
  suspicions: Suspicion[];
  /** Bevestigd niet leuk: komt nooit meer. */
  disliked: string[];
};
