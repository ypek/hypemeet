/**
 * The server lists' catalogues (lists.ts), kept ready on the server.
 *
 * The panel takes seconds to build them (the films alone are ~17 MB of JSON) and they're the same for everyone on
 * the list, so one copy answers everybody: fresh for FRESH_MS; after that it still answers at once while a new copy
 * is fetched behind it; past MAX_AGE_MS the new copy is waited for. Kept gzipped, ready to send.
 */

/** The big, slow calls worth keeping (the rest, like EPG or a title's details, go straight to the panel). */
export const CACHED_ACTIONS = new Set(["get_live_streams", "get_vod_streams", "get_series", "get_live_categories", "get_vod_categories", "get_series_categories"]);

export type CatalogCopy = { at: number; gzip: Uint8Array<ArrayBuffer>; type: string };
type Fetched = { text: string; type: string } | null;

export function createCatalogCache({ freshMs, maxAgeMs, now = Date.now }: { freshMs: number; maxAgeMs: number; now?: () => number }) {
  const copies = new Map<string, CatalogCopy>();
  const loading = new Map<string, Promise<CatalogCopy | null>>();

  /** One fetch at a time per key; a failed or non-JSON answer (XUI's HTML error pages) isn't kept. */
  const refresh = (key: string, fetcher: () => Promise<Fetched>) => {
    let pending = loading.get(key);
    if (!pending) {
      pending = fetcher()
        .then((got) => {
          if (!got || !/^\s*[[{]/.test(got.text)) return null;
          const copy = { at: now(), gzip: Bun.gzipSync(Buffer.from(got.text), { level: 6 }), type: got.type };
          copies.set(key, copy);
          return copy;
        })
        .catch(() => null)
        .finally(() => loading.delete(key));
      loading.set(key, pending);
    }
    return pending;
  };

  return {
    /** The copy to answer with, or null when the panel has none to give (the caller then answers as before). */
    async get(key: string, fetcher: () => Promise<Fetched>): Promise<CatalogCopy | null> {
      const copy = copies.get(key);
      const age = copy ? now() - copy.at : Infinity;
      if (copy && age < freshMs) return copy;
      if (copy && age < maxAgeMs) {
        void refresh(key, fetcher);
        return copy;
      }
      return (await refresh(key, fetcher)) ?? copy ?? null;
    },
    stats: () => ({ copies: copies.size, bytes: [...copies.values()].reduce((n, c) => n + c.gzip.byteLength, 0) }),
  };
}

/**
 * The key: only what changes the answer (the call and its category). Anything else in the URL is ignored, so random
 * parameters can't make the server fetch the panel again or keep one more copy in memory.
 */
export function catalogKey(listId: string, params: URLSearchParams): string | null {
  const action = params.get("action");
  if (!action || !CACHED_ACTIONS.has(action)) return null;
  const category = params.get("category_id");
  return `${listId}?action=${action}${category && /^\d{1,10}$/.test(category) ? `&category_id=${category}` : ""}`;
}
