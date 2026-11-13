/**
 * The same channel in several qualities, as lists carry them ("TELECINE ACTION FHD", "… FHD [H265]", "… HD",
 * "… SD"): grouped so the player can offer a lighter one when the connection can't keep up.
 */
import { fold } from "./net";
import type { CatalogItem } from "./types";

const QUALITIES: { label: string; rank: number; test: RegExp }[] = [
  { label: "4K", rank: 0, test: /\b(4k|uhd|2160p?)\b/i },
  { label: "FHD", rank: 1, test: /\b(fhdr?|1080p?)\b/i },
  { label: "HD", rank: 2, test: /\b(hd|720p?)\b/i },
  { label: "SD", rank: 3, test: /\b(sd|576p?|480p?|360p?)\b/i },
];

export interface Quality {
  label: string;
  /** 0 = heaviest (4K) … 3 = lightest (SD); unknown counts as FHD-ish. */
  rank: number;
}

export function qualityOf(name: string): Quality {
  const base = QUALITIES.find((q) => q.test.test(name));
  const extra = [/\bh\.?265\b|\bhevc\b/i.test(name) && "H265", /\balt\b/i.test(name) && "ALT"].filter(Boolean).join(" ");
  const label = [base?.label ?? "Padrão", extra].filter(Boolean).join(" ");
  // H265 needs less bandwidth than H264 at the same resolution.
  const rank = (base?.rank ?? 1.5) + (/\bh\.?265\b|\bhevc\b/i.test(name) ? 0.5 : 0);
  return { label, rank };
}

/** The channel without its quality tags: what its variants share. */
export function variantKey(name: string): string {
  return fold(name)
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/\b(4k|uhd|fhdr?|hd|sd|h\.?26[45]|hevc|alt|\d{3,4}p)\b|[²³¹]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface Variant {
  item: CatalogItem;
  quality: Quality;
}

/** Live items by variant key; only keys with more than one item are kept. */
export function variantIndex(items: CatalogItem[]): Map<string, Variant[]> {
  const all = new Map<string, Variant[]>();
  for (const item of items) {
    const key = variantKey(item.name);
    if (!key) continue;
    const list = all.get(key) ?? [];
    list.push({ item, quality: qualityOf(item.name) });
    all.set(key, list);
  }
  const out = new Map<string, Variant[]>();
  for (const [key, list] of all) if (list.length > 1) out.set(key, list.sort((a, b) => a.quality.rank - b.quality.rank || a.item.name.localeCompare(b.item.name)));
  return out;
}

/** The next lighter version of what's playing, if any. */
export function lighter(variants: Variant[], playingKey: string): Variant | undefined {
  const current = variants.find((v) => v.item.key === playingKey);
  if (!current) return undefined;
  return variants.find((v) => v.quality.rank > current.quality.rank);
}
