/**
 * HypeTv's server: the built page (dist/), the relay in proxy.ts and the artwork lookups in art.ts.
 *
 *   GET  api/fetch?u=…   playlists, Xtream API, EPG: the body as the IPTV server sent it (up to MAX_TEXT)
 *   GET  api/stream?u=…  streams; HLS playlists come back rewritten to point here again
 *   GET  api/img?u=…     logos and posters, cached (imgur and resellers' hosts refuse or drop hotlinks)
 *   POST api/art         { items: [{ kind, name, year?, tvgId? }] } → { results: [{ image?, backdrop? } | null] }
 *   GET  api/lists       the lists everyone starts with (HYPETV_LISTS): id and name only
 *   GET  api/x/<id>/…    one of those, spoken to as an Xtream panel; the login is added here (lists.ts)
 *
 * Both take `ua` and `ref` (user agent and referrer a list asked for). Everything answers with
 * Access-Control-Allow-Origin: * — inside the Discord Activity the plugin runs on an opaque origin.
 */
import { join, normalize } from "node:path";
import { createArt, type ArtKind } from "./art";
import { createFanout } from "./fanout";
import { parseLists, publicLists, scrubLogin, upstreamFor } from "./lists";
import { BlockedError, fetchPublic, looksLikeHls, rewriteHls, upstreamHeaders, type ProxyPolicy } from "./proxy";

const PRODUCTION = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? (PRODUCTION ? 3002 : 5175));
const DIST = join(import.meta.dir, "..", "dist");
/** Big M3U files (a whole catalogue of films and series) run into the tens of MB. */
const MAX_TEXT = 150 * 1024 * 1024;
const MAX_HLS = 5 * 1024 * 1024;
const TEXT_TIMEOUT_MS = 90_000;
/** Until the IPTV server answers with headers; the body of a live stream then flows for as long as it plays. */
const STREAM_HEADERS_TIMEOUT_MS = 20_000;
/** Long-lived streams at once, across everyone: a guard against the relay being used as a free CDN. */
const MAX_STREAMS = Number(process.env.HYPETV_MAX_STREAMS ?? 40);

const policy: ProxyPolicy = {
  allowPrivate: process.env.HYPETV_ALLOW_PRIVATE === "1" || !PRODUCTION,
  hosts: (process.env.HYPETV_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range, content-type",
  "access-control-expose-headers": "content-length, content-range, accept-ranges, content-type",
};

/** Images: any public host (posters live everywhere), but only images, capped, kept in a small LRU. */
const IMAGE_MAX = 3 * 1024 * 1024;
const IMAGE_CACHE_BYTES = 128 * 1024 * 1024;
const imagePolicy: ProxyPolicy = { ...policy, hosts: [] };
const art = createArt({ tmdbKey: process.env.TMDB_API_KEY?.trim() || undefined, country: process.env.HYPETV_COUNTRY ?? "BR" });

const fail = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: { ...CORS, "cache-control": "no-store" } });

function target(params: URLSearchParams): URL | null {
  try {
    return new URL(params.get("u") ?? "");
  } catch {
    return null;
  }
}

function failure(err: unknown): Response {
  if (err instanceof BlockedError) return fail(err.message, 403);
  const name = (err as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") return fail("O servidor da lista não respondeu a tempo", 504);
  console.error(`relay: ${(err as Error)?.message ?? err}`);
  return fail("Não deu pra falar com o servidor da lista", 502);
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > max) return null;
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function fetchText(req: Request, params: URLSearchParams): Promise<Response> {
  const url = target(params);
  if (!url) return fail("Link inválido", 400);
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(TEXT_TIMEOUT_MS)]);
    const { response } = await fetchPublic(url, { headers: upstreamHeaders(params, null), signal }, policy);
    const body = response.body ? await readCapped(response.body, MAX_TEXT) : new Uint8Array();
    if (!body) return fail("A lista passa de 150 MB", 413);
    return new Response(body, {
      status: response.status,
      headers: {
        ...CORS,
        "content-type": response.headers.get("content-type") ?? "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return failure(err);
  }
}

let streams = 0;
const fanout = createFanout();

/** Relative to the request (…/api/stream?…), so it holds under Discord's /plugins/hypetv/ proxy too. */
function relayUrl(absolute: string, params: URLSearchParams): string {
  const next = new URLSearchParams({ u: absolute });
  for (const key of ["ua", "ref"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return `stream?${next}`;
}

/** A slot under MAX_STREAMS, or null when full; the release is safe to call more than once. */
function takeSlot(): (() => void) | null {
  if (streams >= MAX_STREAMS) return null;
  streams++;
  let released = false;
  return () => {
    if (!released) (released = true), streams--;
  };
}

async function relayStream(req: Request, params: URLSearchParams): Promise<Response> {
  const url = target(params);
  if (!url) return fail("Link inválido", 400);
  // A live channel (the player says so with live=1) is shared: see fanout.ts.
  const shared = params.get("live") === "1" && !req.headers.get("range");
  const key = `${url.href}\u0000${params.get("ua") ?? ""}\u0000${params.get("ref") ?? ""}`;
  if (shared) {
    const release = takeSlot();
    if (!release) return fail("O proxy está cheio agora, tente de novo daqui a pouco", 503);
    const joined = fanout.tryJoin(key, release);
    if (joined) return joined;
    release();
  }
  const headersTimeout = new AbortController();
  const timer = setTimeout(() => headersTimeout.abort(new DOMException("timeout", "TimeoutError")), STREAM_HEADERS_TIMEOUT_MS);
  const signal = AbortSignal.any([req.signal, headersTimeout.signal]);
  let upstream: { response: Response; url: URL };
  try {
    upstream = await fetchPublic(url, { headers: upstreamHeaders(params, req.headers.get("range")), signal }, policy);
  } catch (err) {
    return failure(err);
  } finally {
    clearTimeout(timer);
  }
  const { response } = upstream;
  const type = response.headers.get("content-type");

  if (response.ok && looksLikeHls(type, upstream.url)) {
    const body = response.body ? await readCapped(response.body, MAX_HLS).catch(() => null) : null;
    if (!body) return fail("Playlist HLS inválida", 502);
    const text = rewriteHls(new TextDecoder().decode(body), upstream.url, (abs) => relayUrl(abs, params));
    return new Response(text, {
      headers: { ...CORS, "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
    });
  }

  const headers = new Headers(CORS);
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified"]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  const image = type?.startsWith("image/");
  headers.set("cache-control", image && response.ok ? "public, max-age=86400" : "no-store");
  if (!response.body || image) return new Response(response.body, { status: response.status, headers });

  const release = takeSlot();
  if (!release) {
    await response.body.cancel();
    return fail("O proxy está cheio agora, tente de novo daqui a pouco", 503);
  }
  if (shared && response.ok && response.status === 200) return fanout.open(key, response, headers, release);
  req.signal.addEventListener("abort", release, { once: true });
  const body = response.body.pipeThrough(new TransformStream({ flush: release }));
  return new Response(body, { status: response.status, headers });
}

const images = new Map<string, { body: Uint8Array<ArrayBuffer>; type: string }>();
let imageBytes = 0;

async function relayImage(req: Request, params: URLSearchParams): Promise<Response> {
  const url = target(params);
  if (!url) return fail("Link inválido", 400);
  const headers = (body: { type: string }) => ({ ...CORS, "content-type": body.type, "cache-control": "public, max-age=604800" });
  const hit = images.get(url.href);
  if (hit) {
    images.delete(url.href);
    images.set(url.href, hit);
    return new Response(hit.body, { headers: headers(hit) });
  }
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]);
    const ua = new Headers({ "user-agent": "Mozilla/5.0 (HypeTv)", accept: "image/*,*/*;q=0.5" });
    const { response } = await fetchPublic(url, { headers: ua, signal }, imagePolicy);
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !response.body || !type.startsWith("image/")) {
      await response.body?.cancel();
      return fail("Imagem indisponível", 404);
    }
    const body = await readCapped(response.body, IMAGE_MAX);
    if (!body) return fail("Imagem grande demais", 413);
    const entry = { body, type };
    images.set(url.href, entry);
    imageBytes += body.byteLength;
    for (const [key, old] of images) {
      if (imageBytes <= IMAGE_CACHE_BYTES) break;
      images.delete(key);
      imageBytes -= old.body.byteLength;
    }
    return new Response(body, { headers: headers(entry) });
  } catch (err) {
    return failure(err);
  }
}

const KINDS = new Set<ArtKind>(["live", "movie", "series"]);
const ART_BATCH = 60;

async function resolveArt(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  if (!Array.isArray(body?.items)) return fail("Pedido inválido", 400);
  const results = await Promise.all(
    body.items.slice(0, ART_BATCH).map((raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const kind = it.kind as ArtKind;
      const name = typeof it.name === "string" ? it.name.slice(0, 200) : "";
      if (!KINDS.has(kind) || !name.trim()) return null;
      const year = typeof it.year === "string" && /^d{4}$/.test(it.year) ? it.year : undefined;
      const tvgId = typeof it.tvgId === "string" ? it.tvgId.slice(0, 120) : undefined;
      return art.resolve({ kind, name, year, tvgId });
    }),
  );
  return Response.json({ results }, { headers: { ...CORS, "cache-control": "no-store" } });
}

/** The lists everyone starts with (lists.ts); in Dokploy's env or plugins/hypetv/.env.local, never in git. */
const serverLists = parseLists(process.env.HYPETV_LISTS);

/** api/x/<id>/<path>: one of those lists, as an Xtream panel whose login only this server knows. */
async function serverList(req: Request, url: URL): Promise<Response> {
  const m = /^\/api\/x\/(\d+)\/(.+)$/.exec(url.pathname);
  const list = m && serverLists.find((l) => l.id === m[1]);
  const upstream = m && list ? upstreamFor(serverLists, m[1]!, m[2]!, url.searchParams) : null;
  if (!list || !upstream) return fail("Não encontrado", 404);
  if (upstream.kind === "stream") {
    const params = new URLSearchParams({ u: upstream.url.href });
    if (upstream.live) params.set("live", "1");
    return relayStream(req, params);
  }
  const res = await fetchText(req, new URLSearchParams({ u: upstream.url.href }));
  const text = scrubLogin(await res.text(), list);
  return new Response(text, { status: res.status, headers: res.headers });
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  if (rel.startsWith("..")) return fail("Não encontrado", 404);
  const file = Bun.file(join(DIST, rel || "index.html"));
  const hit = rel && (await file.exists());
  const served = hit ? file : Bun.file(join(DIST, "index.html"));
  const immutable = hit && rel.startsWith("assets/");
  return new Response(served, {
    headers: { ...CORS, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
  });
}

const server = Bun.serve({
  port: PORT,
  // Seconds without a byte either way before Bun drops the connection; a slow panel building a big list can take a while.
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method === "POST" && url.pathname === "/api/art") return resolveArt(req);
    if (req.method !== "GET" && req.method !== "HEAD") return fail("Método não suportado", 405);
    switch (url.pathname) {
      case "/api/fetch":
        return fetchText(req, url.searchParams);
      case "/api/stream":
        return relayStream(req, url.searchParams);
      case "/api/img":
        return relayImage(req, url.searchParams);
      case "/api/lists":
        return Response.json(publicLists(serverLists), { headers: { ...CORS, "cache-control": "no-store" } });
      case "/api/health":
        return Response.json({ ok: true, streams, shared: fanout.stats(), images: images.size, art: art.sources }, { headers: CORS });
    }
    if (url.pathname.startsWith("/api/x/")) return serverList(req, url);
    if (url.pathname.startsWith("/api/")) return fail("Não encontrado", 404);
    return PRODUCTION ? serveStatic(url.pathname) : fail("Em dev a página vem do Vite (porta 5174)", 404);
  },
});

art.warm();
console.log(`hypetv plugin on :${server.port}${policy.allowPrivate ? " (private addresses allowed)" : ""}`);
