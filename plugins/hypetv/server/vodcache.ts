/**
 * Films and episodes through one connection, for the whole room.
 *
 * IPTV accounts often allow a single connection. A film is a file, and every viewer's player asks for its own
 * byte ranges, so a room watching together opens one connection each and the panel cuts them off. Here the first
 * request starts one download of the whole file to disk; every viewer (and every seek) is then served from that
 * copy with proper Range answers, waiting only where the download hasn't reached yet. A copy nobody watches is
 * dropped: right away while it's still downloading (so the account's connection frees up), after a while once
 * complete; the oldest go first when the cache passes its size limit.
 */
import { mkdir, open, readdir, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

/** Paths of Xtream films and episodes (/movie/…, /series/…): files, worth one shared copy. */
export const isVodUrl = (url: URL) => /\/(movie|series)\//i.test(url.pathname);

const READ_CHUNK = 1024 * 1024;
/** A download nobody is reading is abandoned after this (frees the account's one connection). */
const ABANDON_MS = 60_000;
/** A finished copy nobody watched for this long is deleted. */
const EXPIRE_MS = 6 * 3600_000;

interface Entry {
  key: string;
  path: string;
  type: string;
  /** Total bytes, from the panel's Content-Length. */
  size: number;
  /** Bytes on disk so far. */
  have: number;
  done: boolean;
  failed: boolean;
  readers: number;
  lastUsed: number;
  abort: AbortController;
  progress: Set<() => void>;
}

export interface VodCache {
  /** Range-served from the shared copy, or null when this file can't be cached (no length): relay it directly. */
  serve(req: Request, key: string, fetchUpstream: (signal: AbortSignal) => Promise<Response>, extraHeaders: Record<string, string>): Promise<Response | null>;
  stats(): { files: number; bytes: number; downloading: number };
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

export function createVodCache(dir: string, maxBytes: number): VodCache {
  const entries = new Map<string, Entry>();
  let counter = 0;
  // Copies from a previous run are useless (nothing knows their size or source): cleared, the folder kept (a volume).
  const ready = mkdir(dir, { recursive: true }).then(async () => {
    for (const name of await readdir(dir)) await rm(join(dir, name), { recursive: true, force: true });
  });

  const wake = (e: Entry) => {
    for (const f of e.progress) f();
    e.progress.clear();
  };
  const drop = (e: Entry) => {
    if (entries.get(e.key) === e) entries.delete(e.key);
    e.abort.abort();
    wake(e);
    void rm(e.path, { force: true });
  };

  // Housekeeping: abandoned downloads, expired copies, and the size limit (oldest first).
  setInterval(() => {
    const now = Date.now();
    for (const e of entries.values()) {
      if (e.readers) continue;
      if ((!e.done && now - e.lastUsed > ABANDON_MS) || (e.done && now - e.lastUsed > EXPIRE_MS) || e.failed) drop(e);
    }
  }, 15_000).unref?.();

  function makeRoom(incoming: number) {
    let total = [...entries.values()].reduce((n, e) => n + e.size, 0) + incoming;
    for (const e of [...entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (total <= maxBytes) break;
      if (e.readers) continue;
      total -= e.size;
      drop(e);
    }
  }

  async function download(e: Entry, body: ReadableStream<Uint8Array>) {
    let fh: FileHandle | undefined;
    try {
      fh = await open(e.path, "w");
      for await (const chunk of body) {
        if (e.abort.signal.aborted) break;
        await fh.write(chunk, 0, chunk.byteLength, e.have);
        e.have += chunk.byteLength;
        wake(e);
      }
      e.done = !e.abort.signal.aborted && e.have >= e.size;
      if (!e.done && !e.abort.signal.aborted) e.failed = true;
    } catch {
      e.failed = true;
    } finally {
      await fh?.close().catch(() => undefined);
      wake(e);
    }
  }

  async function start(key: string, fetchUpstream: (signal: AbortSignal) => Promise<Response>): Promise<Entry | Response> {
    await ready;
    const abort = new AbortController();
    const res = await fetchUpstream(abort.signal);
    const size = Number(res.headers.get("content-length"));
    if (!res.ok || !res.body || !(size > 0)) {
      // Not cacheable: let go of this connection before the caller opens its own.
      await res.body?.cancel().catch(() => undefined);
      return res;
    }
    makeRoom(size);
    const e: Entry = {
      key,
      path: join(dir, `${Date.now().toString(36)}-${(counter++).toString(36)}.bin`),
      type: res.headers.get("content-type") ?? "application/octet-stream",
      size,
      have: 0,
      done: false,
      failed: false,
      readers: 0,
      lastUsed: Date.now(),
      abort,
      progress: new Set(),
    };
    entries.set(key, e);
    void download(e, res.body);
    return e;
  }

  const waitFor = (e: Entry, offset: number) =>
    new Promise<void>((resolve) => {
      if (e.have > offset || e.done || e.failed || e.abort.signal.aborted) return resolve();
      e.progress.add(resolve);
    });

  function respond(req: Request, e: Entry, extraHeaders: Record<string, string>): Response {
    const range = parseRange(req.headers.get("range"), e.size);
    if (req.headers.get("range") && !range)
      return new Response(null, { status: 416, headers: { ...extraHeaders, "content-range": `bytes */${e.size}` } });
    const startAt = range?.start ?? 0;
    const end = range?.end ?? e.size - 1;
    let pos = startAt;
    let fh: FileHandle | undefined;
    e.readers++;
    e.lastUsed = Date.now();
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      e.readers--;
      e.lastUsed = Date.now();
      void fh?.close().catch(() => undefined);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (pos > end) {
            controller.close();
            return leave();
          }
          // Every chunk wakes every reader: one further ahead keeps waiting until the download reaches it.
          while (e.have <= pos && !e.done && !e.failed && !e.abort.signal.aborted) await waitFor(e, pos);
          if (e.have <= pos) {
            // The download stopped short (panel dropped it): end here, the player will ask again.
            controller.error(new Error("download stopped"));
            return leave();
          }
          fh ??= await open(e.path, "r");
          const length = Math.min(READ_CHUNK, end + 1 - pos, e.have - pos);
          const buf = new Uint8Array(length);
          const { bytesRead } = await fh.read(buf, 0, length, pos);
          pos += bytesRead;
          e.lastUsed = Date.now();
          controller.enqueue(bytesRead === length ? buf : buf.subarray(0, bytesRead));
        } catch (err) {
          controller.error(err);
          leave();
        }
      },
      cancel: leave,
    });
    const headers: Record<string, string> = {
      ...extraHeaders,
      "content-type": e.type,
      "content-length": String(end - startAt + 1),
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };
    if (range) headers["content-range"] = `bytes ${startAt}-${end}/${e.size}`;
    return new Response(body, { status: range ? 206 : 200, headers });
  }

  const starting = new Map<string, Promise<Entry | Response>>();

  return {
    async serve(req, key, fetchUpstream, extraHeaders) {
      let e = entries.get(key);
      if (e && (e.failed || e.abort.signal.aborted)) {
        drop(e);
        e = undefined;
      }
      if (!e) {
        let pending = starting.get(key);
        if (!pending) {
          pending = start(key, fetchUpstream).finally(() => starting.delete(key));
          starting.set(key, pending);
        }
        const got = await pending;
        if (got instanceof Response) return null;
        e = got;
      }
      return respond(req, e, extraHeaders);
    },
    stats() {
      const all = [...entries.values()];
      return { files: all.length, bytes: all.reduce((n, e) => n + e.have, 0), downloading: all.filter((e) => !e.done).length };
    },
  };
}
