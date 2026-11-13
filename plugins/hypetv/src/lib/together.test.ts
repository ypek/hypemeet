import { expect, test } from "bun:test";
import { expectedPosition, parseWire, shareable } from "./together";

test("now: only a well-formed http(s) item gets through", () => {
  const item = { url: "http://tv.example/live/u/p/1.m3u8", title: "Globo", live: true, alt: ["http://tv.example/live/u/p/1.ts", "javascript:alert(1)"], headers: { ua: "VLC" } };
  expect(parseWire(JSON.stringify({ v: 1, t: "now", item, position: 12 }))).toEqual({
    v: 1,
    t: "now",
    item: { url: item.url, title: "Globo", live: true, alt: ["http://tv.example/live/u/p/1.ts"], headers: { ua: "VLC" } },
    paused: false,
    position: 12,
  });
  expect(parseWire(JSON.stringify({ v: 1, t: "now", item: { ...item, url: "javascript:alert(1)" } }))).toBeNull();
  expect(parseWire(JSON.stringify({ v: 1, t: "now", item: { url: item.url, title: "", live: true } }))).toBeNull();
  expect(parseWire(JSON.stringify({ v: 2, t: "hello" }))).toBeNull();
  expect(parseWire("not json")).toBeNull();
});

test("sync and ctl need a sane position and a paused flag", () => {
  expect(parseWire(JSON.stringify({ v: 1, t: "sync", paused: true, position: 30.5 }))).toEqual({ v: 1, t: "sync", paused: true, position: 30.5 });
  expect(parseWire(JSON.stringify({ v: 1, t: "ctl", paused: false, position: -1 }))).toBeNull();
  expect(parseWire(JSON.stringify({ v: 1, t: "sync", paused: "no", position: 1 }))).toBeNull();
});

test("shareable drops what only makes sense on our own list", () => {
  expect(shareable({ url: "https://a.example/x.m3u8", title: "X", live: true, epgId: 7 })).toEqual({ url: "https://a.example/x.m3u8", title: "X", live: true });
});

test("expected position runs on while playing, holds while paused", () => {
  expect(expectedPosition({ paused: false, position: 10, receivedAt: 1000 }, 4000)).toBe(13);
  expect(expectedPosition({ paused: true, position: 10, receivedAt: 1000 }, 4000)).toBe(10);
});
