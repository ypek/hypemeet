import { expect, test } from "bun:test";
import type { CatalogItem } from "./types";
import { lighter, qualityOf, variantIndex, variantKey } from "./variants";

const item = (key: string, name: string): CatalogItem => ({ key, kind: "live", name, group: "Canais" });

test("qualities and what variants share", () => {
  expect(qualityOf("TELECINE ACTION FHD").label).toBe("FHD");
  expect(qualityOf("TELECINE ACTION FHD [H265]").label).toBe("FHD H265");
  expect(qualityOf("GLOBO RJ HD [ALT]").label).toBe("HD ALT");
  expect(qualityOf("Record SP SD").rank).toBe(3);
  expect(qualityOf("Canal Qualquer").label).toBe("Padrão");
  expect(variantKey("TELECINE ACTION FHD [H265]")).toBe("telecine action");
  expect(variantKey("Telecine Action SD")).toBe("telecine action");
  expect(variantKey("GLOBO SP 4K FHDR")).toBe("globo sp");
});

test("variants of a channel, heaviest first, and the next lighter one", () => {
  const index = variantIndex([
    item("1", "TELECINE ACTION FHD"),
    item("2", "TELECINE ACTION FHD [H265]"),
    item("3", "TELECINE ACTION HD"),
    item("4", "TELECINE ACTION SD"),
    item("5", "ESPN 3 FHD"),
  ]);
  const tc = index.get("telecine action")!;
  expect(tc.map((v) => v.quality.label)).toEqual(["FHD", "FHD H265", "HD", "SD"]);
  expect(lighter(tc, "1")?.quality.label).toBe("FHD H265");
  expect(lighter(tc, "3")?.quality.label).toBe("SD");
  expect(lighter(tc, "4")).toBeUndefined();
  // A channel with a single version has no variants.
  expect(index.has("espn 3")).toBe(false);
});
