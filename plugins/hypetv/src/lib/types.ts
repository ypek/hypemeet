import type { Kind, StreamHeaders } from "./m3u";

export type { Kind, StreamHeaders };

/** Something the player can open: a channel, a film or an episode. */
export interface Playable {
  url: string;
  /** Tried in order when `url` won't play (an Xtream live as .ts after .m3u8, say). */
  alt?: string[];
  title: string;
  /** Group, or "T1 · E3" for episodes. */
  subtitle?: string;
  logo?: string;
  live: boolean;
  headers?: StreamHeaders;
  /** Xtream stream id, for the guide (get_short_epg). */
  epgId?: number;
}

export interface Episode {
  key: string;
  season: number;
  episode: number;
  title: string;
  logo?: string;
  plot?: string;
  duration?: string;
  play: Playable;
}

export interface CatalogItem {
  /** Stable within a list: favourites and recents are kept by it. */
  key: string;
  kind: Kind;
  name: string;
  logo?: string;
  group: string;
  /** M3U tvg-id: the surest way to a channel's official logo. */
  tvgId?: string;
  /** Channels and films. */
  play?: Playable;
  /** Shows: episodes come with an M3U list, an Xtream one fetches them when opened. */
  series?: { xtreamId: number } | { episodes: Episode[] };
  info?: { rating?: string; year?: string; plot?: string; /** When the panel added it (ms): "Adicionados recentemente". */ added?: number };
}

export interface Section {
  items: CatalogItem[];
  /** In the list's own order. */
  groups: { name: string; count: number }[];
}

export type Catalog = Partial<Record<Kind, Section>>;

export const KIND_LABEL: Record<Kind, string> = { live: "Ao vivo", movie: "Filmes", series: "Séries" };
