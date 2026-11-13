import { expect, test } from "bun:test";
import { catalogKey, createCatalogCache } from "./catalogcache";

const text = (s: Uint8Array<ArrayBuffer>) => new TextDecoder().decode(Bun.gunzipSync(s));

test("catalog cache: one fetch for everyone, fresh copy at once, stale copy refreshed behind it", async () => {
  let clock = 0;
  let calls = 0;
  let body = '[{"name":"A"}]';
  const cache = createCatalogCache({ freshMs: 100, maxAgeMs: 1000, now: () => clock });
  const fetcher = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return { text: body, type: "application/json" };
  };
  // Three at once: one call to the panel.
  const [a, b, c] = await Promise.all([cache.get("k", fetcher), cache.get("k", fetcher), cache.get("k", fetcher)]);
  expect(calls).toBe(1);
  expect(a).toBe(b);
  expect(b).toBe(c);
  expect(text(a!.gzip)).toBe('[{"name":"A"}]');
  // Still fresh: no call.
  clock = 50;
  await cache.get("k", fetcher);
  expect(calls).toBe(1);
  // Stale: the old copy answers now, the new one arrives behind it.
  clock = 500;
  body = '[{"name":"B"}]';
  const stale = await cache.get("k", fetcher);
  expect(text(stale!.gzip)).toBe('[{"name":"A"}]');
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toBe(2);
  expect(text((await cache.get("k", fetcher))!.gzip)).toBe('[{"name":"B"}]');
});

test("catalog cache: error pages and failures aren't kept", async () => {
  const cache = createCatalogCache({ freshMs: 100, maxAgeMs: 1000 });
  expect(await cache.get("k", async () => ({ text: "<html>INVALID_CREDENTIALS</html>", type: "text/html" }))).toBeNull();
  expect(await cache.get("k", async () => null)).toBeNull();
  expect(await cache.get("k", async () => Promise.reject(new Error("down")))).toBeNull();
  expect(cache.stats().copies).toBe(0);
});

test("catalog key: only the big calls, without the login", () => {
  expect(catalogKey("1", new URLSearchParams("username=-&password=-&action=get_vod_streams"))).toBe("1?action=get_vod_streams");
  expect(catalogKey("1", new URLSearchParams("action=get_vod_streams&category_id=7&username=x"))).toBe("1?action=get_vod_streams&category_id=7");
  expect(catalogKey("1", new URLSearchParams("action=get_short_epg&stream_id=1"))).toBeNull();
  expect(catalogKey("1", new URLSearchParams("username=-&password=-"))).toBeNull();
});
