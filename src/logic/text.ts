// Tekst-hulpjes: namen van nummers en artiesten vergelijken zonder last van hoofdletters,
// accenten, "feat." of "- Remastered 2011".

/** Kleine letters, zonder accenten en leestekens. "Voilà" -> "voila", "LUM!X" -> "lumx". */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9Ѐ-ӿͰ-Ͽ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Titel zonder toevoegingen als "(feat. X)", "- Remastered", "- Radio Edit". */
export function normTitle(title: string): string {
  const cut = title
    .replace(/\s*[\(\[][^\)\]]*(feat|ft\.|with|remaster|version|edit|mix|live|mono|stereo|deluxe|from)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo|deluxe|from|single).*$/i, '');
  return norm(cut);
}

/** Sleutel om hetzelfde nummer in een andere versie te herkennen. */
export function songKey(title: string, artists: string[]): string {
  return `${normTitle(title)}|${norm(artists[0] ?? '')}`;
}

/** Komt een van de artiesten voor in de lijst? Vergelijkt genormaliseerd en exact per naam. */
export function artistIn(artists: string[], list: string[]): boolean {
  if (!list.length) return false;
  const set = new Set(list.map(norm).filter(Boolean));
  return artists.some((a) => set.has(norm(a)));
}

/** Lijken twee artiestennamen op elkaar ("Morgan Wallen" vs "morgan wallen")? Ook deel-namen ("LUM!X" in "LUM!X, Gabry Ponte"). */
export function sameArtist(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y;
}

/** Hebben twee nummers een artiest gemeen? */
export function shareArtist(a: string[], b: string[]): boolean {
  const set = new Set(a.map(norm));
  return b.some((x) => set.has(norm(x)));
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
