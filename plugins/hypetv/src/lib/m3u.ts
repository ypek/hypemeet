/**
 * M3U / M3U8 playlists as IPTV lists write them (the "extended" flavour, with #EXTINF attributes):
 *
 *   #EXTM3U url-tvg="http://…/epg.xml"
 *   #EXTINF:-1 tvg-id="globo.br" tvg-logo="http://…/globo.png" group-title="Abertos",Globo HD
 *   #EXTVLCOPT:http-user-agent=Mozilla/5.0
 *   http://server:8080/live/user/pass/123.ts
 *
 * Lists exported by Xtream panels (get.php?type=m3u_plus) mix channels, films and series episodes; the path of
 * each link (/movie/, /series/) tells them apart.
 */

export type Kind = "live" | "movie" | "series";

export interface StreamHeaders {
  ua?: string;
  ref?: string;
}

export interface M3UEntry {
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
  kind: Kind;
  headers?: StreamHeaders;
  /** Episodes ("Show S01 E02"): the show they belong to. */
  show?: { name: string; season: number; episode: number };
}

export interface M3UPlaylist {
  entries: M3UEntry[];
  /** XMLTV guide announced in the header. */
  epgUrl?: string;
}

export const NO_GROUP = "Sem categoria";

/** `key="value"` or `key=value` pairs, as far as the first comma outside quotes. */
function readAttributes(text: string): { attrs: Record<string, string>; rest: string } {
  const attrs: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    while (text[i] === " " || text[i] === "\t") i++;
    if (i >= text.length || text[i] === ",") break;
    const keyStart = i;
    while (i < text.length && text[i] !== "=" && text[i] !== " " && text[i] !== ",") i++;
    const key = text.slice(keyStart, i).toLowerCase();
    if (text[i] !== "=") continue; // the duration (-1) or a bare word
    i++;
    let value: string;
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      value = text.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? text.length : end + 1;
    } else {
      const start = i;
      while (i < text.length && text[i] !== " " && text[i] !== ",") i++;
      value = text.slice(start, i);
    }
    if (key) attrs[key] = value.trim();
  }
  return { attrs, rest: text[i] === "," ? text.slice(i + 1) : "" };
}

const EPISODE = /^(.*?)[\s._-]*\bS(\d{1,2})\s*[._-]?\s*E(\d{1,3})\b/i;

export function parseEpisode(name: string): M3UEntry["show"] | undefined {
  const m = EPISODE.exec(name);
  if (!m || !m[1]!.trim()) return undefined;
  return { name: m[1]!.trim().replace(/[\s:._-]+$/, ""), season: Number(m[2]), episode: Number(m[3]) };
}

export function kindOf(url: string): Kind {
  if (/\/movie\//i.test(url)) return "movie";
  if (/\/series\//i.test(url)) return "series";
  return "live";
}

/** Kodi style: `http://…/stream|User-Agent=Foo&Referer=http://…` */
function splitPipeHeaders(raw: string): { url: string; headers: StreamHeaders } {
  const bar = raw.indexOf("|");
  if (bar === -1) return { url: raw, headers: {} };
  const headers: StreamHeaders = {};
  for (const pair of raw.slice(bar + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).toLowerCase();
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // as is
    }
    if (key === "user-agent") headers.ua = value;
    if (key === "referer" || key === "referrer") headers.ref = value;
  }
  return { url: raw.slice(0, bar), headers };
}

export function parseM3U(text: string): M3UPlaylist {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const entries: M3UEntry[] = [];
  let epgUrl: string | undefined;
  let pending: { name: string; attrs: Record<string, string> } | null = null;
  let group: string | undefined;
  let headers: StreamHeaders = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) {
      const { attrs } = readAttributes(line.slice(7));
      epgUrl = attrs["url-tvg"] || attrs["x-tvg-url"] || attrs["tvg-url"] || epgUrl;
      epgUrl = epgUrl?.split(",")[0]?.trim() || undefined;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const { attrs, rest } = readAttributes(line.slice(8));
      pending = { name: rest.trim() || attrs["tvg-name"] || "", attrs };
      group = undefined;
      headers = {};
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      group = line.slice(8).trim() || undefined;
      continue;
    }
    if (line.startsWith("#EXTVLCOPT:")) {
      const opt = line.slice(11);
      const eq = opt.indexOf("=");
      const key = opt.slice(0, eq).toLowerCase();
      const value = opt.slice(eq + 1).trim();
      if (key === "http-user-agent") headers.ua = value;
      if (key === "http-referrer" || key === "http-referer") headers.ref = value;
      continue;
    }
    if (line.startsWith("#")) continue;

    // A link: with the #EXTINF before it, or bare (plain M3U).
    const split = splitPipeHeaders(line);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(split.url)) {
      pending = null;
      continue;
    }
    const attrs = pending?.attrs ?? {};
    const name = pending?.name || attrs["tvg-name"] || split.url.split("/").pop() || split.url;
    const merged = { ...headers, ...split.headers };
    if (attrs["http-user-agent"] || attrs["user-agent"]) merged.ua = attrs["http-user-agent"] || attrs["user-agent"];
    if (attrs["http-referrer"]) merged.ref = attrs["http-referrer"];
    const kind = kindOf(split.url);
    const entry: M3UEntry = {
      name,
      url: split.url,
      group: (attrs["group-title"] || group || NO_GROUP).trim() || NO_GROUP,
      kind,
    };
    if (attrs["tvg-logo"]) entry.logo = attrs["tvg-logo"];
    if (attrs["tvg-id"]) entry.tvgId = attrs["tvg-id"];
    if (merged.ua || merged.ref) entry.headers = merged;
    if (kind === "series") entry.show = parseEpisode(name) ?? { name, season: 1, episode: 1 };
    entries.push(entry);
    pending = null;
    group = undefined;
    headers = {};
  }
  return { entries, epgUrl };
}
