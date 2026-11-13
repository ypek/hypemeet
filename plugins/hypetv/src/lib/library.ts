import { NO_GROUP, type M3UPlaylist } from "./m3u";
import { fold } from "./net";
import type { Catalog, CatalogItem, Episode, Kind, Section } from "./types";
import { linkKey } from "./xtream";

function section(items: CatalogItem[]): Section {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
  return { items, groups: [...counts].map(([name, count]) => ({ name, count })) };
}

/** Channels, films and shows out of an M3U list; episodes are folded into one item per show. */
export function catalogFromM3U(list: M3UPlaylist): Catalog {
  const byKind: Record<Kind, CatalogItem[]> = { live: [], movie: [], series: [] };
  const shows = new Map<string, CatalogItem & { series: { episodes: Episode[] } }>();
  const seen = new Set<string>();
  for (const entry of list.entries) {
    let key = linkKey(entry.url);
    // The same link twice (a channel in two groups): keys must stay unique for favourites.
    for (let n = 2; seen.has(key); n++) key = `${linkKey(entry.url)}-${n}`;
    seen.add(key);
    const play = {
      url: entry.url,
      title: entry.name,
      subtitle: entry.group === NO_GROUP ? undefined : entry.group,
      logo: entry.logo,
      live: entry.kind === "live",
      headers: entry.headers,
    };
    if (entry.kind !== "series" || !entry.show) {
      byKind[entry.kind].push({ key, kind: entry.kind, name: entry.name, logo: entry.logo, group: entry.group, tvgId: entry.tvgId, play });
      continue;
    }
    const { name, season, episode } = entry.show;
    const showKey = `${entry.group}\u0000${fold(name)}`;
    let show = shows.get(showKey);
    if (!show) {
      show = { key: `s${linkKey(showKey)}`, kind: "series", name, logo: entry.logo, group: entry.group, series: { episodes: [] } };
      shows.set(showKey, show);
      byKind.series.push(show);
    }
    show.logo ??= entry.logo;
    show.series.episodes.push({
      key,
      season,
      episode,
      title: `Episódio ${episode}`,
      logo: entry.logo,
      play: { ...play, title: `${name} · T${season} E${episode}`, subtitle: entry.name, live: false },
    });
  }
  for (const show of shows.values()) show.series.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const catalog: Catalog = {};
  for (const kind of ["live", "movie", "series"] as const) if (byKind[kind].length) catalog[kind] = section(byKind[kind]);
  return catalog;
}

const searchText = new WeakMap<CatalogItem, string>();
const textOf = (item: CatalogItem) => {
  let text = searchText.get(item);
  if (text === undefined) searchText.set(item, (text = fold(`${item.name} ${item.group}`)));
  return text;
};

export const ALL = "\u0000all";
export const FAVORITES = "\u0000fav";
export const RECENTS = "\u0000recent";

/** One group (or all, favourites, recents), narrowed by a search: every word has to match. */
export function filterItems(
  items: CatalogItem[],
  { group, query, favorites, recents }: { group: string; query: string; favorites: Set<string>; recents: string[] },
): CatalogItem[] {
  let pool: CatalogItem[];
  if (group === RECENTS) {
    const byKey = new Map(items.map((i) => [i.key, i]));
    pool = recents.map((k) => byKey.get(k)).filter((i): i is CatalogItem => !!i);
  } else if (group === FAVORITES) pool = items.filter((i) => favorites.has(i.key));
  else if (group === ALL) pool = items;
  else pool = items.filter((i) => i.group === group);
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return pool;
  return pool.filter((item) => {
    const text = textOf(item);
    return words.every((w) => text.includes(w));
  });
}

export const seasonsOf = (episodes: Episode[]) => [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
