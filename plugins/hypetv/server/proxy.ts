/**
 * The plugin's relay to IPTV servers. A page on HTTPS can't play HTTP streams, and IPTV panels don't send CORS
 * headers, so playlists, Xtream API calls and the streams themselves come through here.
 *
 * It fetches whatever a page asks for, so it only goes to public addresses: every hop of a redirect is
 * resolved and checked, and private, loopback and link-local ranges are refused (HYPETV_ALLOW_PRIVATE=1 lifts
 * that in dev, for the mock server). HYPETV_HOSTS narrows it further to the hosts listed.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedError extends Error {}

const MAX_REDIRECTS = 5;

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** Loopback, private, link-local, CGNAT, multicast and reserved: anything that isn't the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return ipv4Private(ip);
  if (family !== 6) return true;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return ipv4Private(mapped[1]!);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff")
  );
}

export interface ProxyPolicy {
  allowPrivate: boolean;
  /** Hostnames (and their subdomains) the first request may go to; empty = any public host. */
  hosts: string[];
}

export function hostAllowed(hostname: string, hosts: string[]): boolean {
  if (!hosts.length) return true;
  const h = hostname.toLowerCase();
  return hosts.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** Throws BlockedError unless the URL is http(s) on a public address. */
export async function assertPublic(url: URL, policy: ProxyPolicy): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedError("Só links http e https");
  if (url.username || url.password) throw new BlockedError("Link com usuário embutido");
  if (policy.allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new BlockedError("Endereço fora da internet pública");
}

/** Like fetch, but follows redirects itself so every hop goes through assertPublic. */
export async function fetchPublic(
  url: URL,
  init: { headers: Headers; signal: AbortSignal; method?: string },
  policy: ProxyPolicy,
): Promise<{ response: Response; url: URL }> {
  if (!hostAllowed(url.hostname, policy.hosts)) throw new BlockedError("Servidor fora da lista permitida (HYPETV_HOSTS)");
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current, policy);
    const response = await fetch(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current);
      continue;
    }
    return { response, url: current };
  }
  throw new BlockedError("Redirecionamentos demais");
}

export function looksLikeHls(contentType: string | null, url: URL): boolean {
  const type = (contentType ?? "").toLowerCase();
  return type.includes("mpegurl") || /\.m3u8$/i.test(url.pathname);
}

/**
 * Points every URI of an HLS playlist (segments, variants, keys, init maps, renditions) back at the proxy, so
 * the player never has to reach the IPTV server itself. `toProxy` gets absolute URLs.
 */
export function rewriteHls(text: string, base: URL, toProxy: (absolute: string) => string): string {
  const resolve = (uri: string) => {
    try {
      return toProxy(new URL(uri, base).href);
    } catch {
      return uri;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${resolve(uri)}"`);
      return resolve(trimmed);
    })
    .join("\n");
}

/** Headers we pass upstream: a player-like agent (some panels turn browsers away), the referrer a list asked for. */
export function upstreamHeaders(params: URLSearchParams, range: string | null): Headers {
  const headers = new Headers({
    "user-agent": params.get("ua")?.slice(0, 300) || "VLC/3.0.20 LibVLC/3.0.20",
    accept: "*/*",
  });
  const referrer = params.get("ref");
  if (referrer) headers.set("referer", referrer.slice(0, 500));
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
  return headers;
}
