/**
 * Xtream Codes API (player_api.php), the one IPTV panels (Xtream UI, XUI.one…) speak:
 *
 *   player_api.php?username&password                       → user_info + server_info (the login check)
 *   …&action=get_live_categories | get_vod_categories | get_series_categories
 *   …&action=get_live_streams | get_vod_streams | get_series
 *   …&action=get_series_info&series_id=                     → seasons and episodes
 *   …&action=get_short_epg&stream_id=&limit=                → now / next, titles in base64
 *
 * Streams live at <server>/live|movie|series/<user>/<pass>/<id>.<ext>.
 */
import { NO_GROUP } from "./m3u";
import { fetchText, hash, ListError } from "./net";
import type { CatalogItem, Episode, Kind, Section } from "./types";

export interface XtreamLogin {
  server: string;
  username: string;
  password: string;
}

export interface XtreamAccount {
  status: string;
  /** ms, or null when it doesn't expire. */
  expires: number | null;
  maxConnections: number | null;
  /** Output formats the panel lets this account use ("m3u8", "ts"…). */
  formats: string[];
}

export interface GuideEntry {
  title: string;
  description: string;
  start: number;
  end: number;
}

/** "tv.example.com:8080/", "http://tv.example.com/player_api.php" → "http://tv.example.com:8080" */
export function normalizeServer(input: string): string {
  let text = input.trim();
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  const url = new URL(text);
  const path = url.pathname.replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, "").replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/** A get.php / player_api.php link carries the whole login; such lists open better as Xtream. */
export function parseXtreamLink(link: string): XtreamLogin | null {
  try {
    const url = new URL(link.trim());
    if (!/\/(get|player_api)\.php$/i.test(url.pathname)) return null;
    const username = url.searchParams.get("username");
    const password = url.searchParams.get("password");
    if (!username || !password) return null;
    return { server: normalizeServer(url.href), username, password };
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : null;
};
const ext = (v: unknown, fallback: string) => (/^[a-z0-9]{2,5}$/i.test(str(v)) ? str(v) : fallback);

function decode64(text: unknown): string {
  const raw = str(text);
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return raw;
  }
}

function groupsOf(items: CatalogItem[]): Section["groups"] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

export class Xtream {
  readonly login: XtreamLogin;
  /**
   * Set by account(). ts when the panel allows it: through the relay, one connection serves the whole room
   * (server/fanout.ts), and accounts often allow just one. m3u8 stays as the fallback.
   */
  liveFormat: "m3u8" | "ts" = "ts";

  constructor(login: XtreamLogin) {
    this.login = { ...login, server: normalizeServer(login.server) };
  }

  private url(path: string) {
    const { server, username, password } = this.login;
    return `${server}/${path}/${encodeURIComponent(username)}/${encodeURIComponent(password)}`;
  }

  private async api<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const { server, username, password } = this.login;
    const query = new URLSearchParams({ username, password, ...params });
    const text = await fetchText(`${server}/player_api.php?${query}`, signal);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ListError("O servidor não respondeu como um Xtream Codes");
    }
  }

  async account(signal?: AbortSignal): Promise<XtreamAccount> {
    const data = await this.api<{ user_info?: Record<string, unknown> }>({}, signal);
    const info = data?.user_info;
    if (!info || num(info.auth) !== 1) throw new ListError("Usuário ou senha inválidos");
    const status = str(info.status) || "Active";
    if (/expired/i.test(status)) throw new ListError("A assinatura dessa lista venceu");
    if (!/active/i.test(status)) throw new ListError(`Conta ${status.toLowerCase()} no servidor`);
    const formats = Array.isArray(info.allowed_output_formats) ? info.allowed_output_formats.map(str) : [];
    this.liveFormat = formats.length && !formats.includes("ts") ? "m3u8" : "ts";
    const exp = num(info.exp_date);
    return { status, expires: exp ? exp * 1000 : null, maxConnections: num(info.max_connections), formats };
  }

  private async categories(kind: Kind, signal?: AbortSignal): Promise<Map<string, string>> {
    const action = { live: "get_live_categories", movie: "get_vod_categories", series: "get_series_categories" }[kind];
    const list = await this.api<unknown>({ action }, signal);
    const map = new Map<string, string>();
    if (Array.isArray(list))
      for (const c of list as Record<string, unknown>[]) map.set(str(c.category_id), str(c.category_name) || NO_GROUP);
    return map;
  }

  /** One tab's worth: every channel, film or show, with the panel's categories as groups (in its order). */
  async section(kind: Kind, signal?: AbortSignal): Promise<Section> {
    const action = { live: "get_live_streams", movie: "get_vod_streams", series: "get_series" }[kind];
    const [names, list] = await Promise.all([this.categories(kind, signal), this.api<unknown>({ action }, signal)]);
    const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
    const items: CatalogItem[] = [];
    for (const row of rows) {
      const name = str(row.name) || "Sem nome";
      const group = names.get(str(row.category_id)) ?? NO_GROUP;
      if (kind === "series") {
        const id = num(row.series_id);
        if (id === null) continue;
        items.push({
          key: `s${id}`,
          kind,
          name,
          group,
          logo: str(row.cover) || undefined,
          series: { xtreamId: id },
          info: { rating: str(row.rating) || undefined, year: str(row.year ?? row.releaseDate ?? row.release_date).slice(0, 4) || undefined, plot: str(row.plot) || undefined, added: (num(row.last_modified) ?? 0) * 1000 || undefined },
        });
        continue;
      }
      const id = num(row.stream_id);
      if (id === null) continue;
      const logo = str(row.stream_icon) || undefined;
      if (kind === "live") {
        const base = `${this.url("live")}/${id}`;
        const [first, second] = this.liveFormat === "m3u8" ? ["m3u8", "ts"] : ["ts", "m3u8"];
        items.push({
          key: `l${id}`,
          kind,
          name,
          group,
          logo,
          play: { url: `${base}.${first}`, alt: [`${base}.${second}`], title: name, subtitle: group, logo, live: true, epgId: id },
        });
      } else {
        const url = `${this.url("movie")}/${id}.${ext(row.container_extension, "mp4")}`;
        items.push({
          key: `m${id}`,
          kind,
          name,
          group,
          logo,
          play: { url, title: name, subtitle: group, logo, live: false },
          info: { rating: str(row.rating) || undefined, year: str(row.year).slice(0, 4) || undefined, added: (num(row.added) ?? 0) * 1000 || undefined },
        });
      }
    }
    return { items, groups: groupsOf(items) };
  }

  async episodes(seriesId: number, signal?: AbortSignal): Promise<{ info: TitleInfo; episodes: Episode[] }> {
    const data = await this.api<{ info?: Record<string, unknown>; episodes?: Record<string, unknown> }>(
      { action: "get_series_info", series_id: String(seriesId) },
      signal,
    );
    const show = str(data?.info?.name) || "Série";
    const cover = str(data?.info?.cover) || undefined;
    const episodes: Episode[] = [];
    const seasons = data?.episodes && typeof data.episodes === "object" ? data.episodes : {};
    for (const [season, list] of Object.entries(seasons)) {
      if (!Array.isArray(list)) continue;
      for (const row of list as Record<string, unknown>[]) {
        const id = str(row.id);
        if (!id) continue;
        const info = (row.info ?? {}) as Record<string, unknown>;
        const s = num(row.season) ?? num(season) ?? 1;
        const e = num(row.episode_num) ?? episodes.length + 1;
        const title = str(row.title) || `Episódio ${e}`;
        const logo = str(info.movie_image) || cover;
        episodes.push({
          key: `e${id}`,
          season: s,
          episode: e,
          title,
          logo,
          plot: str(info.plot) || undefined,
          duration: str(info.duration) || undefined,
          play: {
            url: `${this.url("series")}/${id}.${ext(row.container_extension, "mp4")}`,
            title: `${show} · T${s} E${e}`,
            subtitle: title,
            logo,
            live: false,
          },
        });
      }
    }
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return { info: titleInfo(data?.info ?? {}), episodes };
  }

  /** A film's page (IPTVnator's VOD detail): artwork, plot, people, genres. */
  async movieInfo(vodId: number, signal?: AbortSignal): Promise<TitleInfo> {
    const data = await this.api<{ info?: Record<string, unknown> }>({ action: "get_vod_info", vod_id: String(vodId) }, signal);
    return titleInfo(data?.info ?? {});
  }

  /** Now and next for a live channel; empty when the panel has no guide for it. */
  async guide(streamId: number, signal?: AbortSignal): Promise<GuideEntry[]> {
    const data = await this.api<{ epg_listings?: Record<string, unknown>[] }>(
      { action: "get_short_epg", stream_id: String(streamId), limit: "4" },
      signal,
    );
    const rows = Array.isArray(data?.epg_listings) ? data.epg_listings : [];
    return rows
      .map((row) => ({
        title: decode64(row.title),
        description: decode64(row.description),
        start: (num(row.start_timestamp) ?? Date.parse(str(row.start)) / 1000) * 1000,
        end: (num(row.stop_timestamp) ?? Date.parse(str(row.end)) / 1000) * 1000,
      }))
      .filter((g) => g.title && Number.isFinite(g.start) && Number.isFinite(g.end) && g.end > Date.now());
  }
}

/** What a detail page shows about a film or a show. Panels fill these from TMDB, under a few spellings. */
export interface TitleInfo {
  poster?: string;
  backdrop?: string;
  plot?: string;
  genres: string[];
  cast?: string;
  director?: string;
  year?: string;
  /** "1h 52min" */
  duration?: string;
  rating?: number;
  trailer?: string;
}

export function titleInfo(info: Record<string, unknown>): TitleInfo {
  const first = (...keys: string[]) => keys.map((k) => info[k]).map((v) => (Array.isArray(v) ? str(v[0]) : str(v))).find(Boolean) || undefined;
  const secs = num(info.duration_secs) ?? (() => {
    const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(str(info.duration));
    return m ? (m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])) : null;
  })();
  const minutes = secs ? Math.round(secs / 60) : num(info.episode_run_time);
  const rating = Number.parseFloat(str(info.rating));
  return {
    poster: first("movie_image", "cover_big", "cover"),
    backdrop: first("backdrop_path", "backdrop"),
    plot: first("plot", "description"),
    genres: (first("genre") ?? "").split(/\s*[,/|]\s*/).filter(Boolean).slice(0, 4),
    cast: first("cast", "actors"),
    director: first("director"),
    year: (first("releasedate", "releaseDate", "release_date", "year") ?? "").slice(0, 4) || undefined,
    duration: minutes ? (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}min` : `${minutes}min`) : undefined,
    rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
    trailer: first("youtube_trailer"),
  };
}

/** Stable key for a link in an M3U list. */
export const linkKey = (url: string) => `u${hash(url)}`;
