import { expect, test } from "bun:test";
import { createFanout, syncOffset } from "./fanout";

const packet = (fill: number) => {
  const p = new Uint8Array(188).fill(fill);
  p[0] = 0x47;
  return p;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
};

test("sync offset: two sync bytes a packet apart", () => {
  const stream = concat(new Uint8Array([1, 0x47, 3]), packet(1), packet(2));
  expect(syncOffset(stream)).toBe(3);
  expect(syncOffset(packet(9))).toBe(0);
  expect(syncOffset(new Uint8Array([1, 2, 3]))).toBe(-1);
});

/** An upstream we can push chunks into. */
function upstream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
    cancel: () => void (cancelled = true),
  });
  return { response: new Response(body, { status: 200 }), push: (c: Uint8Array) => controller.enqueue(c), end: () => controller.close(), cancelled: () => cancelled };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("one upstream feeds every viewer; a late viewer starts on a packet boundary", async () => {
  const fanout = createFanout();
  const up = upstream();
  const headers = new Headers({ "content-type": "video/mp2t" });
  const first = fanout.open("ch", up.response, headers, () => {});
  const r1 = first.body!.getReader();
  up.push(packet(1));
  expect((await r1.read()).value).toEqual(packet(1));

  const second = fanout.tryJoin("ch", () => {})!;
  expect(second.headers.get("content-type")).toBe("video/mp2t");
  const r2 = second.body!.getReader();
  const read2 = r2.read();
  await tick();
  // Mid-packet chunk: the late viewer skips to the next sync byte.
  up.push(concat(new Uint8Array([7, 7, 7]), packet(2), packet(3)));
  expect((await read2).value).toEqual(concat(packet(2), packet(3)));
  expect((await r1.read()).value!.length).toBe(3 + 188 * 2);
  expect(fanout.stats()).toEqual({ channels: 1, viewers: 2 });

  up.end();
  expect((await r1.read()).done).toBe(true);
  expect((await r2.read()).done).toBe(true);
  expect(fanout.tryJoin("ch", () => {})).toBeNull();
});

test("the upstream closes shortly after the last viewer leaves", async () => {
  const fanout = createFanout();
  const up = upstream();
  let left = 0;
  const res = fanout.open("ch", up.response, new Headers(), () => left++);
  await res.body!.cancel();
  expect(left).toBe(1);
  expect(up.cancelled()).toBe(false);
  // Rejoining within the linger reuses the same upstream.
  const again = fanout.tryJoin("ch", () => left++)!;
  await again.body!.cancel();
  await new Promise((r) => setTimeout(r, 1700));
  expect(up.cancelled()).toBe(true);
  expect(fanout.stats()).toEqual({ channels: 0, viewers: 0 });
});
