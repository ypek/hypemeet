import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVodCache, isVodUrl, parseRange } from "./vodcache";

const dir = mkdtempSync(join(tmpdir(), "hypetv-vod-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("ranges and which links are films", () => {
  expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
  expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
  expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  expect(parseRange("bytes=200-", 100)).toBeNull();
  expect(parseRange("bytes=0-5,10-15", 100)).toBeNull();
  expect(isVodUrl(new URL("http://tv.example/movie/u/p/1.mp4"))).toBe(true);
  expect(isVodUrl(new URL("http://tv.example/series/u/p/9.mkv"))).toBe(true);
  expect(isVodUrl(new URL("http://tv.example/live/u/p/1.ts"))).toBe(false);
});

/** A panel serving a 3 MB file in chunks we release one at a time. */
function panel() {
  const file = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
  let calls = 0;
  let release: () => void = () => {};
  const fetchUpstream = async () => {
    calls++;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (sent >= file.length) return c.close();
        await new Promise<void>((r) => (release = r));
        const chunk = file.subarray(sent, sent + 512 * 1024);
        sent += chunk.length;
        c.enqueue(chunk);
      },
    });
    return new Response(body, { headers: { "content-length": String(file.length), "content-type": "video/mp4" } });
  };
  return { file, fetchUpstream, calls: () => calls, step: () => release() };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

test("one download, many viewers, each with its own ranges, served as the file arrives", async () => {
  const cache = createVodCache(dir, 1024 * 1024 * 1024);
  const p = panel();
  const ask = (range?: string) => cache.serve(new Request("http://x/", { headers: range ? { range } : {} }), "film", p.fetchUpstream, { "access-control-allow-origin": "*" });

  const a = (await ask("bytes=0-"))!;
  expect(a.status).toBe(206);
  expect(a.headers.get("content-range")).toBe(`bytes 0-${p.file.length - 1}/${p.file.length}`);
  // A second viewer and a seek join the same download.
  const pending = ask("bytes=2000000-2000099");
  const b = (await ask("bytes=100-199"))!;
  expect(p.calls()).toBe(1);

  const bodyB = b.arrayBuffer();
  for (let i = 0; i < 6; i++) {
    p.step();
    await tick();
  }
  expect(new Uint8Array(await bodyB)).toEqual(p.file.subarray(100, 200));
  const seek = (await pending)!;
  expect(seek.headers.get("content-length")).toBe("100");
  expect(new Uint8Array(await seek.arrayBuffer())).toEqual(p.file.subarray(2_000_000, 2_000_100));
  await a.body!.cancel();
  expect(cache.stats().files).toBe(1);
});
