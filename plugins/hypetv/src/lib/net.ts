import type { StreamHeaders } from "./types";

/** Relative to the page, so it holds under Discord's /plugins/hypetv/ proxy too. */
const API = () => new URL("api/", document.baseURI);

/** What a user should read when a list won't load. */
export class ListError extends Error {}

/** `live`: a live MPEG-TS channel, which the relay shares between everyone watching it (server/fanout.ts). */
/** Our own server (a list it holds, api/x/…): fetched as is, never relayed through itself. */
export const isOwn = (url: string) => url.startsWith(API().href);

export function relay(kind: "fetch" | "stream" | "img", url: string, headers?: StreamHeaders, live = false): string {
  if (isOwn(url)) return url;
  const target = new URL(kind, API());
  target.searchParams.set("u", url);
  if (headers?.ua) target.searchParams.set("ua", headers.ua);
  if (headers?.ref) target.searchParams.set("ref", headers.ref);
  if (live) target.searchParams.set("live", "1");
  return target.href;
}

/** A page served over HTTPS can't load HTTP media; those go through the relay. */
export const blockedAsMixed = (url: string) => location.protocol === "https:" && /^http:/i.test(url);

/** CDNs that serve hotlinked images reliably: loaded straight from them. */
const DIRECT = /^https:\/\/(image\.tmdb\.org|cdn\.jsdelivr\.net|upload\.wikimedia\.org|thumb\.wikimedia\.org)\//i;

/**
 * Logos and posters. The big CDNs are loaded directly; everything else (imgur refuses hotlinks, resellers' hosts
 * come and go, HTTP is blocked on HTTPS pages) comes through the relay, which also caches them.
 */
export function imageUrl(url: string | undefined, tmdbSize?: "w185" | "w342" | "w500" | "w780" | "w1280"): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  // Lists link TMDB's big renditions (w780, original); a grid of posters only needs a fraction of that.
  if (tmdbSize) url = url.replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)(w\d+|original)\//i, `$1${tmdbSize}/`);
  return DIRECT.test(url) ? url : relay("img", url);
}

/**
 * Panels answer errors with HTTP 200 and an HTML page (XUI.one "Debug Mode" with INVALID_CREDENTIALS, for
 * one). Read as a list it would just look empty; this turns it into the reason.
 */
export function errorPageReason(text: string): string | null {
  const head = text.slice(0, 4000);
  if (!/^\s*</.test(head)) return null;
  if (/INVALID_CREDENTIALS|invalid (username|password)/i.test(head)) return "Usuário ou senha inválidos";
  if (/EXPIRED/i.test(head)) return "A assinatura dessa lista venceu";
  if (/BANNED|BLOCKED|DISABLED/i.test(head)) return "O servidor bloqueou esse acesso";
  if (/MAX_CONNECTIONS|connections/i.test(head)) return "Limite de conexões da lista atingido";
  if (/<html|<!doctype/i.test(head)) return "O servidor respondeu uma página em vez da lista";
  return null;
}

/** Fetches through the relay (IPTV servers send no CORS headers). Throws ListError with a reason to show. */
export async function fetchText(url: string, signal?: AbortSignal, headers?: StreamHeaders): Promise<string> {
  let res: Response;
  try {
    res = await fetch(relay("fetch", url, headers), { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ListError("Sem conexão com o servidor do plugin");
  }
  const text = await res.text();
  if (!res.ok) {
    let reason: string | undefined;
    try {
      reason = (JSON.parse(text) as { error?: string }).error;
    } catch {
      // not ours: the IPTV server's own status
    }
    if (reason) throw new ListError(reason);
    if (res.status === 401 || res.status === 403) throw new ListError(`O servidor recusou o acesso (HTTP ${res.status})`);
    if (res.status === 404) throw new ListError("Lista não encontrada (HTTP 404)");
    throw new ListError(`O servidor respondeu HTTP ${res.status}`);
  }
  const reason = errorPageReason(text);
  if (reason) throw new ListError(reason);
  return text;
}

/** For search: lower case, without accents. */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** FNV-1a, base 36: short stable keys out of links. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
