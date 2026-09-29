// Spotify: inloggen met PKCE (geen geheime sleutel nodig) en de Web API-aanroepen die de DJ gebruikt.
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import type { Track } from '../logic/types';
import type { Device } from '../logic/queue';
import * as W from 'spotify-watcher';

WebBrowser.maybeCompleteAuthSession();

export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
];

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

/** Deze redirect-URI moet je exact zo in het Spotify-dashboard zetten. */
export const REDIRECT_URI = 'freakingdj://callback';

const K_REFRESH = 'spotify_refresh';
const K_ACCESS = 'spotify_access';
const K_EXPIRES = 'spotify_expires';
const K_CLIENT = 'spotify_client';
const K_LOGIN_AT = 'spotify_login_at';

export class SpotifyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let access: { token: string; expires: number } | null = null;

export async function isConnected(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(K_REFRESH));
}

/** Wanneer je voor het laatst inlogde (Spotify laat de koppeling na ~6 maanden verlopen). */
export async function loginAt(): Promise<number | null> {
  const v = await SecureStore.getItemAsync(K_LOGIN_AT);
  return v ? Number(v) : null;
}

export async function login(clientId: string): Promise<void> {
  const req = new AuthSession.AuthRequest({
    clientId,
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
  });
  const res = await req.promptAsync(discovery);
  if (res.type !== 'success' || !res.params.code) {
    if (res.type === 'error') throw new SpotifyError(0, res.params.error_description || res.params.error || 'Inloggen mislukt');
    throw new SpotifyError(0, 'Inloggen afgebroken');
  }
  const tokens = await AuthSession.exchangeCodeAsync(
    { clientId, code: res.params.code, redirectUri: REDIRECT_URI, extraParams: { code_verifier: req.codeVerifier ?? '' } },
    discovery,
  );
  if (!tokens.refreshToken) throw new SpotifyError(0, 'Spotify gaf geen refresh-token terug');
  await SecureStore.setItemAsync(K_CLIENT, clientId);
  await SecureStore.setItemAsync(K_REFRESH, tokens.refreshToken);
  await SecureStore.setItemAsync(K_LOGIN_AT, String(Date.now()));
  await storeAccess(tokens.accessToken, tokens.expiresIn ?? 3600);
  // De meeluister-dienst beheert het token voortaan (ook met je scherm uit).
  await W.authSet(clientId, tokens.refreshToken, tokens.accessToken, Date.now() + (tokens.expiresIn ?? 3600) * 1000);
}

export async function logout(): Promise<void> {
  access = null;
  await W.authClear();
  await Promise.all([K_REFRESH, K_ACCESS, K_EXPIRES, K_LOGIN_AT].map((k) => SecureStore.deleteItemAsync(k)));
}

async function storeAccess(token: string, expiresIn: number) {
  access = { token, expires: Date.now() + (expiresIn - 60) * 1000 };
  await SecureStore.setItemAsync(K_ACCESS, token);
  await SecureStore.setItemAsync(K_EXPIRES, String(access.expires));
}

async function refresh(): Promise<string> {
  const refreshToken = await SecureStore.getItemAsync(K_REFRESH);
  const clientId = await SecureStore.getItemAsync(K_CLIENT);
  if (!refreshToken || !clientId) throw new SpotifyError(401, 'Spotify is niet gekoppeld (zie Instellingen).');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${encodeURIComponent(clientId)}`;
  const res = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') {
      await logout();
      throw new SpotifyError(401, 'De Spotify-koppeling is verlopen. Koppel opnieuw in Instellingen.');
    }
    throw new SpotifyError(res.status, `Spotify-token vernieuwen mislukt (${res.status})`);
  }
  if (json.refresh_token) await SecureStore.setItemAsync(K_REFRESH, json.refresh_token);
  await storeAccess(json.access_token, json.expires_in ?? 3600);
  return json.access_token;
}

/** Native module aanwezig: die is eigenaar van het token (één refresh-token, geen dubbel vernieuwen). */
async function nativeToken(force: boolean): Promise<string> {
  if (!W.hasAuth()) {
    // Eenmalig overzetten vanuit een oudere versie.
    const refreshToken = await SecureStore.getItemAsync(K_REFRESH);
    const clientId = await SecureStore.getItemAsync(K_CLIENT);
    if (!refreshToken || !clientId) throw new SpotifyError(401, 'Spotify is niet gekoppeld (zie Instellingen).');
    const a = await SecureStore.getItemAsync(K_ACCESS);
    const e = Number((await SecureStore.getItemAsync(K_EXPIRES)) ?? 0);
    await W.authSet(clientId, refreshToken, a ?? '', e);
  }
  try {
    return await W.accessToken(force);
  } catch (e: any) {
    if (!W.hasAuth()) {
      await SecureStore.deleteItemAsync(K_REFRESH);
      throw new SpotifyError(401, 'De Spotify-koppeling is verlopen. Koppel opnieuw in Instellingen.');
    }
    throw new SpotifyError(0, e?.message ?? 'Spotify-token ophalen mislukt');
  }
}

async function token(force = false): Promise<string> {
  if (W.available) return nativeToken(force);
  if (access && access.expires > Date.now()) return access.token;
  const t = await SecureStore.getItemAsync(K_ACCESS);
  const e = Number((await SecureStore.getItemAsync(K_EXPIRES)) ?? 0);
  if (t && e > Date.now()) {
    access = { token: t, expires: e };
    return t;
  }
  return refresh();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(status: number, msg: string): string {
  if (status === 404 && /device/i.test(msg)) return 'Geen actief Spotify-apparaat gevonden.';
  if (status === 403 && /premium/i.test(msg)) return 'Hiervoor is Spotify Premium nodig.';
  if (status === 403) return `Spotify weigert dit: ${msg}`;
  if (status === 429) return 'Spotify zegt: te veel verzoeken. Probeer het zo nog eens.';
  return msg || `Spotify-fout ${status}`;
}

/** Eén Web API-aanroep, met token vernieuwen bij 401 en kort wachten bij 429. */
export async function sp<T = any>(path: string, init: RequestInit = {}, attempt = 0): Promise<T | null> {
  const t = await token();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 401 && attempt === 0) {
    access = null;
    if (W.available) await token(true);
    else await refresh();
    return sp<T>(path, init, 1);
  }
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(8, Number(res.headers.get('Retry-After') ?? 2)) * 1000;
    await sleep(wait);
    return sp<T>(path, init, attempt + 1);
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new SpotifyError(res.status, friendly(res.status, json?.error?.message ?? text.slice(0, 120)));
  return json as T;
}

// ---------- vertalen ----------

export function toTrack(t: any): Track | null {
  if (!t || t.type !== 'track' || !t.id) return null;
  const images: any[] = t.album?.images ?? [];
  const small = images.length ? images[images.length - 1]?.url : undefined;
  const mid = images.find((i) => i.width && i.width <= 320)?.url;
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists ?? []).map((a: any) => a.name),
    durationMs: t.duration_ms ?? 0,
    image: mid ?? small,
  };
}

const tracks = (list: any[]): Track[] => list.map(toTrack).filter((x): x is Track => !!x);

// ---------- geschiedenis ----------

export async function topTracks(range: 'short_term' | 'medium_term' | 'long_term'): Promise<Track[]> {
  const r = await sp<any>(`/me/top/tracks?time_range=${range}&limit=50`);
  return tracks(r?.items ?? []);
}

export async function recentlyPlayed(): Promise<{ track: Track; playedAt: number }[]> {
  const r = await sp<any>('/me/player/recently-played?limit=50');
  return (r?.items ?? [])
    .map((it: any) => ({ track: toTrack(it.track), playedAt: Date.parse(it.played_at) }))
    .filter((x: any) => x.track);
}

export async function savedTracks(max = 200): Promise<Track[]> {
  const out: Track[] = [];
  for (let offset = 0; offset < max; offset += 50) {
    const r = await sp<any>(`/me/tracks?limit=50&offset=${offset}`);
    const items = (r?.items ?? []).map((it: any) => toTrack(it.track)).filter(Boolean) as Track[];
    out.push(...items);
    if (items.length < 50) break;
  }
  return out;
}

export async function me(): Promise<{ id: string; name: string } | null> {
  const r = await sp<any>('/me');
  return r ? { id: r.id, name: r.display_name ?? r.id } : null;
}

// ---------- zoeken ----------

export async function searchTracks(q: string): Promise<Track[]> {
  const r = await sp<any>(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
  return tracks(r?.tracks?.items ?? []);
}

// ---------- speler ----------

export type Playback = {
  device: Device | null;
  item: Track | null;
  progressMs: number;
  isPlaying: boolean;
  at: number; // wanneer opgehaald
};

function toDevice(d: any): Device {
  return {
    id: d.id ?? null,
    name: d.name ?? 'Onbekend apparaat',
    type: d.type ?? '',
    isActive: !!d.is_active,
    isRestricted: !!d.is_restricted,
    supportsVolume: d.supports_volume !== false && d.volume_percent != null,
    volume: d.volume_percent ?? null,
  };
}

export async function devices(): Promise<Device[]> {
  const r = await sp<any>('/me/player/devices');
  return (r?.devices ?? []).map(toDevice);
}

export async function playback(): Promise<Playback> {
  const r = await sp<any>('/me/player?additional_types=track');
  if (!r) return { device: null, item: null, progressMs: 0, isPlaying: false, at: Date.now() };
  return {
    device: r.device ? toDevice(r.device) : null,
    item: toTrack(r.item),
    progressMs: r.progress_ms ?? 0,
    isPlaying: !!r.is_playing,
    at: Date.now(),
  };
}

export async function queue(): Promise<{ current: Track | null; next: Track[] }> {
  const r = await sp<any>('/me/player/queue');
  return { current: toTrack(r?.currently_playing), next: tracks(r?.queue ?? []) };
}

const dev = (deviceId?: string | null) => (deviceId ? `device_id=${encodeURIComponent(deviceId)}` : '');

export async function addToQueue(trackId: string, deviceId?: string | null): Promise<void> {
  const q = [`uri=${encodeURIComponent(`spotify:track:${trackId}`)}`, dev(deviceId)].filter(Boolean).join('&');
  await sp(`/me/player/queue?${q}`, { method: 'POST' });
}

/** Speelt losse nummers af (geen playlist of album). */
export async function playTracks(trackIds: string[], deviceId?: string | null): Promise<void> {
  const q = dev(deviceId);
  await sp(`/me/player/play${q ? `?${q}` : ''}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: trackIds.map((id) => `spotify:track:${id}`) }),
  });
}

export async function next(deviceId?: string | null): Promise<void> {
  const q = dev(deviceId);
  await sp(`/me/player/next${q ? `?${q}` : ''}`, { method: 'POST' });
}

export async function setVolume(percent: number, deviceId?: string | null): Promise<void> {
  const q = [`volume_percent=${Math.round(Math.max(0, Math.min(100, percent)))}`, dev(deviceId)].filter(Boolean).join('&');
  await sp(`/me/player/volume?${q}`, { method: 'PUT' });
}
