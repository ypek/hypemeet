import type { Playable } from "./types";

/**
 * Everything stays in this browser, on the plugin's own origin: the room never sees it. Inside the Discord
 * Activity the plugin runs on an opaque origin with no storage at all, so every accessor falls back to memory
 * (lists last for the session there).
 */

export type PlaylistConfig = { id: string; name: string; addedAt: number } & (
  | { type: "m3u-url"; url: string }
  | { type: "m3u-file"; fileName: string }
  | { type: "xtream"; server: string; username: string; password: string }
);

const PREFIX = "hypetv:v1:";
const memory = new Map<string, string>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = memory.get(key) ?? null;
  try {
    raw = localStorage.getItem(PREFIX + key) ?? raw;
  } catch {
    // opaque origin: memory only
  }
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(PREFIX + key, raw);
  } catch {
    // opaque origin or full: memory only
  }
}

export const persistent = (() => {
  try {
    localStorage.setItem(`${PREFIX}probe`, "1");
    localStorage.removeItem(`${PREFIX}probe`);
    return true;
  } catch {
    return false;
  }
})();

export const loadPlaylists = () => read<PlaylistConfig[]>("playlists", []);
export const savePlaylists = (list: PlaylistConfig[]) => write("playlists", list);

export const loadFavorites = (playlist: string) => new Set(read<string[]>(`fav:${playlist}`, []));
export const saveFavorites = (playlist: string, keys: Set<string>) => write(`fav:${playlist}`, [...keys]);

const RECENT_MAX = 40;
export const loadRecents = (playlist: string) => read<string[]>(`recent:${playlist}`, []);
export function pushRecent(playlist: string, key: string): string[] {
  const next = [key, ...loadRecents(playlist).filter((k) => k !== key)].slice(0, RECENT_MAX);
  write(`recent:${playlist}`, next);
  return next;
}

export function forgetPlaylist(id: string) {
  for (const key of [`fav:${id}`, `recent:${id}`, `progress:${id}`]) {
    memory.delete(key);
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // memory only
    }
  }
  void deleteText(id);
}

export const loadVolume = () => read<{ volume: number; muted: boolean }>("volume", { volume: 1, muted: false });
export const saveVolume = (v: { volume: number; muted: boolean }) => write("volume", v);

export const loadLast = () => read<{ playlist?: string; view?: string }>("last", {});
export const saveLast = (v: { playlist?: string; view?: string }) => write("last", v);

// ---- Big texts (M3U files, cached lists): IndexedDB, since localStorage tops out around 5 MB ------------

const textMemory = new Map<string, string>();
let db: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("hypetv", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("texts");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const database = await openDb();
  if (!database) return undefined;
  return new Promise((resolve) => {
    try {
      const req = op(database.transaction("texts", mode).objectStore("texts"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function getText(key: string): Promise<string | undefined> {
  return textMemory.get(key) ?? ((await run("readonly", (s) => s.get(key))) as string | undefined);
}

export async function putText(key: string, text: string): Promise<void> {
  textMemory.set(key, text);
  await run("readwrite", (s) => s.put(text, key));
}

async function deleteText(key: string): Promise<void> {
  textMemory.delete(key);
  await run("readwrite", (s) => s.delete(key));
}

// ---- Watch progress (films and episodes), as IPTVnator keeps it: resume, "continue watching", ≥ 90% = watched --

export interface Progress {
  /** What it was, so "Continuar assistindo" can resume it without the list loaded. */
  play: Playable;
  /** The film or show it belongs to (an episode's show), for its poster and page. */
  owner?: { key: string; name: string; poster?: string; kind: "movie" | "series" };
  /** Seconds in. */
  t: number;
  /** Duration, seconds. */
  d: number;
  /** When last watched (ms). */
  at: number;
}

export const WATCHED_AT = 0.9;
const PROGRESS_MAX = 300;

export const loadProgress = (playlist: string) => read<Record<string, Progress>>(`progress:${playlist}`, {});

export function saveProgress(playlist: string, key: string, t: number, d: number, play: Playable, owner?: Progress["owner"]): Record<string, Progress> {
  const all = loadProgress(playlist);
  if (!(d > 0) || !(t >= 0)) return all;
  all[key] = { play, owner, t: Math.round(t), d: Math.round(d), at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > PROGRESS_MAX) {
    for (const k of keys.sort((a, b) => all[a]!.at - all[b]!.at).slice(0, keys.length - PROGRESS_MAX)) delete all[k];
  }
  write(`progress:${playlist}`, all);
  return all;
}

/** Started but not finished: what "Continuar assistindo" shows. */
export const inProgress = (p: Progress | undefined) => !!p && p.d > 0 && p.t > 30 && p.t / p.d < WATCHED_AT;
export const watched = (p: Progress | undefined) => !!p && p.d > 0 && p.t / p.d >= WATCHED_AT;

/** The sidebar folded down to its icons (a viewer's choice, kept across lists). */
export const loadSidebarCollapsed = () => read<boolean>("sidebar-collapsed", false);
export const saveSidebarCollapsed = (collapsed: boolean) => write("sidebar-collapsed", collapsed);
