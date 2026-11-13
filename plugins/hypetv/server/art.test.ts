import { expect, test } from "bun:test";
import { channelKey, cleanTitle, findLogo, isAdult, loadLogoIndex } from "./art";

test("channel names lose quality, codec, backup and country tags", () => {
  expect(channelKey("RECORD SP FHD")).toBe("record sp");
  expect(channelKey("GLOBO RJ HD [ALT]")).toBe("globo rj");
  expect(channelKey("ESPN 3 FHD [H265]")).toBe("espn 3");
  expect(channelKey("BR: Canal Sony HD²")).toBe("canal sony");
  expect(channelKey("Discovery H&H")).toBe("discovery h and h");
  expect(channelKey("Telecine Action 1080p")).toBe("telecine action");
});

test("titles: year pulled out, tags dropped", () => {
  expect(cleanTitle("Star Wars: O Mandaloriano e Grogu (2026)")).toEqual({ title: "Star Wars: O Mandaloriano e Grogu", year: "2026" });
  expect(cleanTitle("A Hora do Mal 4K")).toEqual({ title: "A Hora do Mal" });
  expect(cleanTitle("Caminhos do Crime [L]", "2019")).toEqual({ title: "Caminhos do Crime", year: "2019" });
  expect(cleanTitle("Dark S01 E02")).toEqual({ title: "Dark" });
  expect(cleanTitle("Duna - 2021")).toEqual({ title: "Duna", year: "2021" });
  expect(isAdult("[XXX] Algo [Adulto]")).toBe(true);
  expect(isAdult("Matrix")).toBe(false);
});

test("logo lookup: tvg-id, exact name, then fewer words; the country wins ties", async () => {
  const data: Record<string, unknown[]> = {
    channels: [
      { id: "Record.br", name: "Record", alt_names: ["RecordTV"], country: "BR" },
      { id: "Record.pt", name: "Record", alt_names: [], country: "PT" },
      { id: "ESPN3.br", name: "ESPN 3", alt_names: [], country: "BR" },
      { id: "Closed.br", name: "Closed", alt_names: [], country: "BR", closed: "2020-01-01" },
    ],
    logos: [
      { channel: "Record.br", feed: null, url: "https://img.example/record-br.png", width: 512 },
      { channel: "Record.pt", feed: null, url: "https://img.example/record-pt.png", width: 512 },
      { channel: "ESPN3.br", feed: null, url: "https://img.example/espn3.png", width: 256 },
      { channel: "ESPN3.br", feed: null, url: "https://img.example/espn3-big.png", width: 1024 },
      { channel: "Closed.br", feed: null, url: "https://img.example/closed.png", width: 1 },
    ],
  };
  const fetcher = (async (url: string) => Response.json(data[/(channels|logos)\.json$/.exec(url)![1]!])) as unknown as typeof fetch;
  const index = await loadLogoIndex(fetcher);
  expect(findLogo(index, "RECORD SP FHD", undefined, "BR")).toBe("https://img.example/record-br.png");
  expect(findLogo(index, "Record", undefined, "PT")).toBe("https://img.example/record-pt.png");
  expect(findLogo(index, "qualquer", "ESPN3.br@SD", "BR")).toBe("https://img.example/espn3-big.png");
  expect(findLogo(index, "ESPN 3 FHD [H265]", undefined, "BR")).toBe("https://img.example/espn3-big.png");
  expect(findLogo(index, "Closed HD", undefined, "BR")).toBeUndefined();
  expect(findLogo(index, "Canal Desconhecido", undefined, "BR")).toBeUndefined();
});
