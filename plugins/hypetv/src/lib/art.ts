/**
 * Artwork for what's on screen, asked from the server in batches (server/art.ts): official channel logos
 * (iptv-org) and film/series posters (TMDB, Wikipedia). Results are kept for the session.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Kind } from "./types";

export interface ArtQuery {
  kind: Kind;
  name: string;
  year?: string;
  tvgId?: string;
}

export interface ArtResult {
  image?: string;
  /** More to try, in order, when `image` won't load. */
  alts?: string[];
  backdrop?: string;
}

const BATCH = 60;
const DELAY_MS = 40;

const results = new Map<string, ArtResult | null>();
const listeners = new Map<string, Set<() => void>>();
const queued = new Map<string, ArtQuery>();
const asked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export const artKey = (q: ArtQuery) => `${q.kind}\u0000${q.name}\u0000${q.year ?? ""}\u0000${q.tvgId ?? ""}`;

function settle(key: string, value: ArtResult | null) {
  results.set(key, value);
  for (const l of listeners.get(key) ?? []) l();
}

async function flush() {
  timer = undefined;
  const batch = [...queued].slice(0, BATCH);
  for (const [key] of batch) queued.delete(key);
  if (queued.size) timer = setTimeout(flush, DELAY_MS);
  try {
    const res = await fetch(new URL("api/art", document.baseURI), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: batch.map(([, q]) => q) }),
    });
    const { results: found } = (await res.json()) as { results?: (ArtResult | null)[] };
    batch.forEach(([key], i) => settle(key, found?.[i] ?? null));
  } catch {
    batch.forEach(([key]) => settle(key, null));
  }
}

export function requestArt(q: ArtQuery) {
  const key = artKey(q);
  if (results.has(key) || asked.has(key)) return;
  asked.add(key);
  queued.set(key, q);
  timer ??= setTimeout(flush, DELAY_MS);
}

/** undefined while asking, null when nothing was found. Pass null to skip. */
export function useArt(q: ArtQuery | null): ArtResult | null | undefined {
  const key = q ? artKey(q) : "";
  const value = useSyncExternalStore(
    (notify) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(notify);
      return () => set.delete(notify);
    },
    () => (key ? results.get(key) : null),
  );
  // `key` stands for q.
  useEffect(() => {
    if (q) requestArt(q);
  }, [key]);
  return key ? value : null;
}

/** Posters already on TMDB are what a lookup would find anyway: shown as they are. */
export const isTmdbImage = (url?: string) => !!url && /^https:\/\/image\.tmdb\.org\//i.test(url);
