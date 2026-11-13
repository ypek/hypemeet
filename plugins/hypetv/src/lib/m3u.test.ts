import { expect, test } from "bun:test";
import { kindOf, NO_GROUP, parseEpisode, parseM3U } from "./m3u";

test("extended M3U: attributes, title after the comma, guide in the header", () => {
  const list = parseM3U(
    [
      '﻿#EXTM3U url-tvg="http://epg.example.com/guide.xml,http://other/guide.xml"',
      '#EXTINF:-1 tvg-id="globo.br" tvg-name="Globo" tvg-logo="http://img.example.com/globo.png" group-title="Abertos",Globo HD, São Paulo',
      "http://tv.example.com:8080/live/u/p/101.ts",
      "#EXTINF:-1,Canal sem atributos",
      "#EXTGRP:Notícias",
      "https://news.example.com/stream.m3u8",
    ].join("\r\n"),
  );
  expect(list.epgUrl).toBe("http://epg.example.com/guide.xml");
  expect(list.entries).toEqual([
    {
      name: "Globo HD, São Paulo",
      url: "http://tv.example.com:8080/live/u/p/101.ts",
      group: "Abertos",
      kind: "live",
      logo: "http://img.example.com/globo.png",
      tvgId: "globo.br",
    },
    { name: "Canal sem atributos", url: "https://news.example.com/stream.m3u8", group: "Notícias", kind: "live" },
  ]);
});

test("headers from #EXTVLCOPT and from the Kodi pipe suffix", () => {
  const { entries } = parseM3U(
    [
      "#EXTM3U",
      "#EXTINF:-1 group-title=Esportes,Arena",
      "#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Smart TV)",
      "#EXTVLCOPT:http-referrer=https://site.example/",
      "http://a.example/arena.m3u8",
      "#EXTINF:-1,Outro",
      "http://b.example/outro.ts|User-Agent=Kodi%2F20&Referer=https://b.example/",
    ].join("\n"),
  );
  expect(entries[0]!.group).toBe("Esportes");
  expect(entries[0]!.headers).toEqual({ ua: "Mozilla/5.0 (Smart TV)", ref: "https://site.example/" });
  expect(entries[1]!.url).toBe("http://b.example/outro.ts");
  expect(entries[1]!.headers).toEqual({ ua: "Kodi/20", ref: "https://b.example/" });
  // The options belong to the entry above them only.
  expect(parseM3U("#EXTM3U\n#EXTINF:-1,Sem\nhttp://c.example/x.ts").entries[0]!.headers).toBeUndefined();
});

test("Xtream m3u_plus: films and episodes by path, episodes grouped by show", () => {
  const { entries } = parseM3U(
    [
      "#EXTM3U",
      '#EXTINF:-1 tvg-logo="" group-title="Filmes | Ação",Duro de Matar (1988)',
      "http://tv.example.com/movie/u/p/5001.mp4",
      '#EXTINF:-1 group-title="Séries | Drama",Breaking Bad S01 E03',
      "http://tv.example.com/series/u/p/9003.mkv",
      "#EXTINF:-1,Sem grupo",
      "http://tv.example.com/u/p/77",
    ].join("\n"),
  );
  expect(entries.map((e) => e.kind)).toEqual(["movie", "series", "live"]);
  expect(entries[0]!.logo).toBeUndefined();
  expect(entries[1]!.show).toEqual({ name: "Breaking Bad", season: 1, episode: 3 });
  expect(entries[2]!.group).toBe(NO_GROUP);
});

test("episode names in the usual spellings", () => {
  expect(parseEpisode("The Office (US) S02E10")).toEqual({ name: "The Office (US)", season: 2, episode: 10 });
  expect(parseEpisode("Dark - S3 E8")).toEqual({ name: "Dark", season: 3, episode: 8 });
  expect(parseEpisode("Dark.S01.E01")).toEqual({ name: "Dark", season: 1, episode: 1 });
  expect(parseEpisode("Jornal Nacional")).toBeUndefined();
  expect(kindOf("http://x/series/a/b/1.mp4")).toBe("series");
});

test("bare links and junk lines", () => {
  const { entries } = parseM3U("http://a.example/one.ts\n#EXTINF:-1,Quebrado\nnão é link\nhttps://b.example/two.m3u8");
  expect(entries.map((e) => [e.name, e.url])).toEqual([
    ["one.ts", "http://a.example/one.ts"],
    ["two.m3u8", "https://b.example/two.m3u8"],
  ]);
});
