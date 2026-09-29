// GitHub: verzoeken in de branch dj-data zetten, de DJ-workflow starten en het antwoord ophalen.
import * as SecureStore from 'expo-secure-store';
import { utf8ToBase64 } from '../logic/base64';
import type { DjResponse } from '../logic/pool';

const K_TOKEN = 'github_token';
export const DATA_BRANCH = 'dj-data';
export const WORKFLOW = 'dj.yml';

export type RepoRef = { owner: string; repo: string };

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(K_TOKEN);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(K_TOKEN, token.trim());
  else await SecureStore.deleteItemAsync(K_TOKEN);
}

async function gh<T = any>(repo: RepoRef, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<T | null> {
  const token = await getToken();
  if (!token) throw new GitHubError(401, 'Er is nog geen GitHub-token ingesteld (zie Instellingen).');
  const url = path.startsWith('/repos') || path.startsWith('/user') ? path : `/repos/${repo.owner}/${repo.repo}${path}`;
  const res = await fetch(`https://api.github.com${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404) throw new GitHubError(404, 'Niet gevonden');
    if (res.status === 401) throw new GitHubError(401, 'Het GitHub-token werkt niet (verlopen of ongeldig).');
    if (res.status === 403) throw new GitHubError(403, `GitHub weigert dit: ${text.slice(0, 160)}`);
    throw new GitHubError(res.status, `GitHub-fout ${res.status}: ${text.slice(0, 160)}`);
  }
  if (accept.includes('raw')) return text as unknown as T;
  return (text ? JSON.parse(text) : null) as T;
}

/** Controleert token en repo. Geeft een leesbare foutmelding of null. */
export async function checkRepo(repo: RepoRef): Promise<string | null> {
  try {
    const r = await gh<any>(repo, '');
    if (!r?.permissions?.push && r?.permissions) return 'Het token mag niet schrijven in deze repo.';
    return null;
  } catch (e: any) {
    if (e?.status === 404) return `Repo ${repo.owner}/${repo.repo} niet gevonden (of het token heeft er geen toegang toe).`;
    return e?.message ?? String(e);
  }
}

const branchOk = new Set<string>();

/** Maakt de branch dj-data aan (vanaf main) als die nog niet bestaat. */
export async function ensureDataBranch(repo: RepoRef): Promise<void> {
  const key = `${repo.owner}/${repo.repo}`;
  if (branchOk.has(key)) return;
  try {
    await gh(repo, `/git/ref/heads/${DATA_BRANCH}`);
    branchOk.add(key);
    return;
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }
  const main = await gh<any>(repo, '/git/ref/heads/main');
  await gh(repo, '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${DATA_BRANCH}`, sha: main.object.sha }),
  });
}

export async function putRequest(repo: RepoRef, id: string, body: unknown): Promise<void> {
  await gh(repo, `/contents/requests/${id}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `DJ-verzoek ${id}`,
      content: utf8ToBase64(JSON.stringify(body, null, 1)),
      branch: DATA_BRANCH,
    }),
  });
}

export async function dispatch(repo: RepoRef, id: string): Promise<void> {
  await gh(repo, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { request_id: id } }),
  });
}

export async function getResponse(repo: RepoRef, id: string): Promise<DjResponse | null> {
  try {
    const raw = await gh<string>(repo, `/contents/responses/${id}.json?ref=${DATA_BRANCH}&t=${Date.now()}`, {}, 'application/vnd.github.raw+json');
    return raw ? (JSON.parse(raw) as DjResponse) : null;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export type RunInfo = { status: string; conclusion: string | null; url: string };

/** Zoekt de workflow-run bij dit verzoek (de run heet "DJ <id>"). */
export async function findRun(repo: RepoRef, id: string): Promise<RunInfo | null> {
  const r = await gh<any>(repo, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`);
  const run = (r?.workflow_runs ?? []).find((x: any) => x.display_title === `DJ ${id}`);
  return run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null;
}

export type StandbyState = 'klaar' | 'opwarmen' | null;

/** Staat er een warme DJ klaar (of komt die eraan)? */
export async function standbyState(repo: RepoRef): Promise<StandbyState> {
  const r = await gh<any>(repo, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=15`);
  const runs = (r?.workflow_runs ?? []).filter((x: any) => x.display_title === 'DJ standby');
  if (runs.some((x: any) => x.status === 'in_progress')) return 'klaar';
  if (runs.some((x: any) => x.status === 'queued' || x.status === 'waiting' || x.status === 'pending' || x.status === 'requested')) return 'opwarmen';
  return null;
}

/** Start een warme DJ: blijft ~10 minuten klaarstaan voor nieuwe verzoeken. */
export async function startStandby(repo: RepoRef): Promise<void> {
  await dispatch(repo, 'standby');
}
