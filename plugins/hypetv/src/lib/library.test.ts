import { expect, test } from "bun:test";
import { ALL, catalogFromM3U, FAVORITES, filterItems, RECENTS } from "./library";
import { parseM3U } from "./m3u";
import { normalizeServer, parseXtreamLink } from "./xtream";
import { errorPageReason } from "./net";

const list = parseM3U(
  [
    "#EXTM3U",
    '#EXTINF:-1 group-title="Abertos",Globo São Paulo',
    "http://tv.example/live/u/p/1.ts",
    '#EXTINF:-1 group-title="Esportes",ESPN Brasil',
    "http://tv.example/live/u/p/2.ts",
    '#EXTINF:-1 group-title="Abertos",Globo São Paulo',
    "http://tv.example/live/u/p/1.ts",
    '#EXTINF:-1 group-title="Filmes",Matrix',
    "http://tv.example/movie/u/p/10.mp4",
    '#EXTINF:-1 group-title="Séries" tvg-logo="http://img/dark.png",Dark S01 E02',
    "http://tv.example/series/u/p/21.mkv",
    '#EXTINF:-1 group-title="Séries",Dark S01 E01',
    "http://tv.example/series/u/p/20.mkv",
    '#EXTINF:-1 group-title="Séries",Dark S02 E01',
    "http://tv.example/series/u/p/22.mkv",
  ].join("\n"),
);

test("M3U catalogue: tabs by kind, groups in order, episodes folded into shows", () => {
  const catalog = catalogFromM3U(list);
  expect(catalog.live!.groups).toEqual([
    { name: "Abertos", count: 2 },
    { name: "Esportes", count: 1 },
  ]);
  const keys = catalog.live!.items.map((i) => i.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(catalog.movie!.items[0]!.play!.live).toBe(false);
  const shows = catalog.series!.items;
  expect(shows).toHaveLength(1);
  expect(shows[0]!.logo).toBe("http://img/dark.png");
  const episodes = (shows[0]!.series as { episodes: { season: number; episode: number }[] }).episodes;
  expect(episodes.map((e) => [e.season, e.episode])).toEqual([
    [1, 1],
    [1, 2],
    [2, 1],
  ]);
});

test("filter: group, favourites, recents and accent-blind search", () => {
  const items = catalogFromM3U(list).live!.items;
  const none = { favorites: new Set<string>(), recents: [] as string[] };
  expect(filterItems(items, { ...none, group: ALL, query: "sao paulo" })).toHaveLength(2);
  expect(filterItems(items, { ...none, group: "Esportes", query: "" }).map((i) => i.name)).toEqual(["ESPN Brasil"]);
  expect(filterItems(items, { ...none, group: ALL, query: "espn abertos" })).toHaveLength(0);
  const espn = items[1]!.key;
  expect(filterItems(items, { favorites: new Set([espn]), recents: [], group: FAVORITES, query: "" })).toHaveLength(1);
  expect(filterItems(items, { favorites: new Set(), recents: [espn, "gone"], group: RECENTS, query: "" }).map((i) => i.key)).toEqual([espn]);
});

test("Xtream links and servers", () => {
  expect(parseXtreamLink("http://tv.example.com:8080/get.php?username=a&password=b&type=m3u_plus&output=ts")).toEqual({
    server: "http://tv.example.com:8080",
    username: "a",
    password: "b",
  });
  expect(parseXtreamLink("http://tv.example.com/lista.m3u")).toBeNull();
  expect(normalizeServer("tv.example.com:8080/")).toBe("http://tv.example.com:8080");
  expect(normalizeServer("https://tv.example.com/player_api.php")).toBe("https://tv.example.com");
});

test("error pages panels send with HTTP 200", () => {
  expect(errorPageReason("<html><title>XUI.one - Debug Mode</title>INVALID_CREDENTIALS Username or password is invalid.")).toBe(
    "Usuário ou senha inválidos",
  );
  expect(errorPageReason("<!doctype html><p>nginx</p>")).toBe("O servidor respondeu uma página em vez da lista");
  expect(errorPageReason("#EXTM3U\n")).toBeNull();
  expect(errorPageReason('{"user_info":{}}')).toBeNull();
});
