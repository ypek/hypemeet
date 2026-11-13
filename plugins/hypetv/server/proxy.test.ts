import { expect, test } from "bun:test";
import { assertPublic, BlockedError, fetchPublic, hostAllowed, isPrivateAddress, isTransient, rewriteHls, streamErrorReason, upstreamHeaders } from "./proxy";

test("private, loopback and link-local addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"])
    expect(isPrivateAddress(ip)).toBe(true);
  for (const ip of ["8.8.8.8", "172.32.0.1", "200.147.67.142", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip)).toBe(false);
  expect(isPrivateAddress("not-an-ip")).toBe(true);
});

test("only http(s) on public addresses, unless private is allowed", async () => {
  const strict = { allowPrivate: false, hosts: [] };
  await expect(assertPublic(new URL("http://127.0.0.1:8080/x"), strict)).rejects.toBeInstanceOf(BlockedError);
  await expect(assertPublic(new URL("http://[::1]/x"), strict)).rejects.toBeInstanceOf(BlockedError);
  await expect(assertPublic(new URL("file:///etc/passwd"), strict)).rejects.toBeInstanceOf(BlockedError);
  await expect(assertPublic(new URL("http://user:pw@8.8.8.8/"), strict)).rejects.toBeInstanceOf(BlockedError);
  await expect(assertPublic(new URL("http://8.8.8.8/x"), strict)).resolves.toBeUndefined();
  await expect(assertPublic(new URL("http://127.0.0.1/x"), { allowPrivate: true, hosts: [] })).resolves.toBeUndefined();
});

test("HYPETV_HOSTS matches the host and its subdomains", () => {
  expect(hostAllowed("tv.example.com", [])).toBe(true);
  expect(hostAllowed("example.com", ["example.com"])).toBe(true);
  expect(hostAllowed("cdn.Example.com", ["example.com"])).toBe(true);
  expect(hostAllowed("badexample.com", ["example.com"])).toBe(false);
});

test("HLS: segments, variants and keys come back through the relay", () => {
  const playlist = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXT-X-MAP:URI="/init.mp4"',
    "#EXTINF:6.0,",
    "seg-1.ts",
    "",
    "#EXTINF:6.0,",
    "https://cdn.example.com/seg-2.ts?token=a b",
  ].join("\n");
  const out = rewriteHls(playlist, new URL("http://tv.example.com/live/abc/index.m3u8"), (abs) => `stream?u=${encodeURIComponent(abs)}`);
  expect(out.split("\n")).toEqual([
    "#EXTM3U",
    `#EXT-X-KEY:METHOD=AES-128,URI="stream?u=${encodeURIComponent("http://tv.example.com/live/abc/key.bin")}"`,
    `#EXT-X-MAP:URI="stream?u=${encodeURIComponent("http://tv.example.com/init.mp4")}"`,
    "#EXTINF:6.0,",
    `stream?u=${encodeURIComponent("http://tv.example.com/live/abc/seg-1.ts")}`,
    "",
    "#EXTINF:6.0,",
    `stream?u=${encodeURIComponent("https://cdn.example.com/seg-2.ts?token=a%20b")}`,
  ]);
});

test("upstream headers: player agent by default, the list's own when given, only simple ranges", () => {
  const plain = upstreamHeaders(new URLSearchParams(), "bytes=0-");
  expect(plain.get("user-agent")).toContain("VLC");
  expect(plain.get("range")).toBe("bytes=0-");
  const custom = upstreamHeaders(new URLSearchParams({ ua: "Kodi", ref: "https://site.example/" }), "bytes=0-1,5-9");
  expect(custom.get("user-agent")).toBe("Kodi");
  expect(custom.get("referer")).toBe("https://site.example/");
  expect(custom.get("range")).toBeNull();
});

test("transient failures: DNS and dropped connections yes; blocks, timeouts and cancels no", () => {
  expect(isTransient(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }))).toBe(true);
  expect(isTransient(Object.assign(new Error("x"), { code: "ConnectionRefused" }))).toBe(true);
  expect(isTransient(new Error("The socket connection was closed unexpectedly"))).toBe(true);
  expect(isTransient(new BlockedError("no"))).toBe(false);
  expect(isTransient(new DOMException("t", "TimeoutError"))).toBe(false);
  expect(isTransient(new DOMException("a", "AbortError"))).toBe(false);
  expect(isTransient(new Error("something else"))).toBe(false);
});

test("fetchPublic: tries the way again after a DNS hiccup, and the error names the hop that failed", async () => {
  const real = globalThis.fetch;
  const policy = { allowPrivate: true, hosts: [] };
  const init = () => ({ headers: new Headers(), signal: new AbortController().signal });
  let calls = 0;
  let cdnFails = 1;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    calls++;
    const url = new URL(String(input));
    // The panel sends to its CDN; the CDN's name fails the first time.
    if (url.hostname === "127.0.0.1") return new Response(null, { status: 302, headers: { location: "http://127.0.0.2/film.mp4" } });
    if (cdnFails-- > 0) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    return new Response("video", { headers: { "content-type": "video/mp4" } });
  }) as typeof fetch;
  try {
    const { response, url } = await fetchPublic(new URL("http://127.0.0.1/movie/1.mp4"), { ...init(), retries: 2 }, policy);
    expect(await response.text()).toBe("video");
    expect(url.hostname).toBe("127.0.0.2");
    expect(calls).toBe(4);
    // Without retries: the error comes back at once, naming the CDN.
    cdnFails = 1;
    const err = await fetchPublic(new URL("http://127.0.0.1/movie/1.mp4"), init(), policy).catch((e) => e);
    expect((err as { code?: string }).code).toBe("ENOTFOUND");
    expect((err as { hostname?: string }).hostname).toBe("127.0.0.2");
  } finally {
    globalThis.fetch = real;
  }
});

test("an error answer to a film or channel: what the viewer reads instead of the panel's page", () => {
  // A film the panel lists but its CDN no longer has (seen: zonalivebox answering 404 for whole films).
  expect(streamErrorReason(404)).toBe("Esse vídeo não está mais no servidor da lista (HTTP 404)");
  expect(streamErrorReason(410)).toBe("Esse vídeo não está mais no servidor da lista (HTTP 410)");
  expect(streamErrorReason(403)).toBe("O servidor da lista recusou esse vídeo (HTTP 403)");
  expect(streamErrorReason(429)).toBe("Limite de conexões da lista atingido (HTTP 429)");
  expect(streamErrorReason(500)).toBe("O servidor da lista respondeu HTTP 500");
});
