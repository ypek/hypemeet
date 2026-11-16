import { expect, test } from "bun:test";
import { createHlsLinks, fromApi } from "./hlslinks";

const PANEL = "http://panel.example:8080/hls/user123/pass456/1000/media.m3u8";

test("a panel URL becomes a code that says nothing, the same one every time, and only this server turns it back", () => {
  const links = createHlsLinks();
  const code = links.codeFor(PANEL);
  expect(code).toMatch(/^[\w-]{22}$/);
  expect(code).not.toContain("user123");
  expect(links.codeFor(PANEL)).toBe(code);
  expect(links.urlFor(code)).toBe(PANEL);
  expect(links.urlFor("x".repeat(22))).toBeNull();
  // Another server (or a restart) has another secret: its codes mean nothing here.
  expect(createHlsLinks().codeFor(PANEL)).not.toBe(code);
});

test("codes nobody used for a while are forgotten; one in use (a variant playlist reloaded) stays", () => {
  let now = 0;
  const links = createHlsLinks({ ttlMs: 1000, now: () => now });
  const variant = links.codeFor(PANEL);
  const segment = links.codeFor(`${PANEL}?seg=1`);
  for (let t = 0; t < 5; t++) {
    now += 600;
    expect(links.urlFor(variant)).toBe(PANEL);
  }
  expect(links.urlFor(segment)).toBeNull();
});

test("never more than max codes: the least recently used go first", () => {
  const links = createHlsLinks({ max: 2 });
  const a = links.codeFor("http://a/1.ts");
  const b = links.codeFor("http://a/2.ts");
  links.urlFor(a);
  links.codeFor("http://a/3.ts");
  expect(links.urlFor(a)).toBe("http://a/1.ts");
  expect(links.urlFor(b)).toBeNull();
  expect(links.size()).toBe(2);
});

test("links relative to the playlist's own address, so they hold under Discord's proxy too", () => {
  const resolve = (from: string, under: string) => new URL(fromApi(from, "x/1/hls/CODE"), `${under}/api/${from}`).href;
  expect(resolve("x/1/live/-/-/1000.m3u8", "https://hypetv.mihawkdev.com")).toBe("https://hypetv.mihawkdev.com/api/x/1/hls/CODE");
  expect(resolve("x/1/hls/OTHER", "https://hypetv.mihawkdev.com")).toBe("https://hypetv.mihawkdev.com/api/x/1/hls/CODE");
  expect(resolve("x/1/live/-/-/1000.m3u8", "https://123.discordsays.com/.proxy/plugins/hypetv")).toBe(
    "https://123.discordsays.com/.proxy/plugins/hypetv/api/x/1/hls/CODE",
  );
});
