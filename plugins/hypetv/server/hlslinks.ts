/**
 * HLS from a server list (lists.ts), without the login reaching the page.
 *
 * A panel's playlists name their variants and segments by URLs that carry the account's user and password (or a
 * session token for them). Rewritten for the page, each of those URLs becomes api/x/<id>/hls/<code>: a code made
 * from the URL with a secret only this process knows, which the server turns back into the panel's URL when the
 * player asks for it. The page can't read a login out of a code, and can't make one up for a URL the panel never
 * sent. Codes live as long as they're used (a variant playlist is reloaded every few seconds) and are forgotten a
 * while after; a restart forgets them all, and the player just opens the channel again.
 */
import { createHmac, randomBytes } from "node:crypto";

export interface HlsLinks {
  codeFor(url: string): string;
  /** The panel's URL behind a code, or null for one this server never made (or forgot). */
  urlFor(code: string): string | null;
  size(): number;
}

export function createHlsLinks({ ttlMs = 10 * 60_000, max = 50_000, now = Date.now } = {}): HlsLinks {
  const secret = randomBytes(32);
  // In order of last use: the oldest first, so forgetting stops at the first one still fresh.
  const urls = new Map<string, { url: string; at: number }>();

  const touch = (code: string, url: string) => {
    urls.delete(code);
    urls.set(code, { url, at: now() });
  };
  const forget = () => {
    for (const [code, entry] of urls) {
      if (urls.size <= max && now() - entry.at <= ttlMs) break;
      urls.delete(code);
    }
  };

  return {
    codeFor(url) {
      const code = createHmac("sha256", secret).update(url).digest("base64url").slice(0, 22);
      touch(code, url);
      forget();
      return code;
    },
    urlFor(code) {
      const entry = urls.get(code);
      if (!entry) return null;
      if (now() - entry.at > ttlMs) {
        urls.delete(code);
        return null;
      }
      touch(code, entry.url);
      return entry.url;
    },
    size: () => urls.size,
  };
}

/**
 * `target` (a path under api/) as a link relative to a request for `from` (also under api/): as many "../" as
 * `from` has folders. Relative, so it works on our domain and under Discord's /.proxy/plugins/hypetv alike.
 */
export function fromApi(from: string, target: string): string {
  return "../".repeat(from.split("/").length - 1) + target;
}
