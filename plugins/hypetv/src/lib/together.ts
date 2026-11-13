/**
 * "Passar pra sala": what goes between the copies of this plugin in the room's browsers (sdk/hypemeet-plugin.ts,
 * topic plugin:hypetv). One person passes a channel or a film; everyone else with the plugin open sees it and can
 * watch along. Whoever passes is the host: their player is the reference for films (pause, position), and the
 * others' play/pause/seek go to them as requests.
 *
 *   hello              just opened: whoever is passing answers with "now"
 *   now  {item, …}     I'm passing this (taking over from whoever was)
 *   sync {paused, position}  host's film, on every play/pause/seek and every few seconds
 *   ctl  {paused, position}  a viewer asks the host to pause/play/seek
 *   stop               I stopped passing
 *
 * Messages come from other people's browsers: everything is checked.
 */
import type { Playable } from "./types";

export type Wire =
  | { v: 1; t: "hello" }
  | { v: 1; t: "now"; item: Playable; paused?: boolean; position?: number }
  | { v: 1; t: "sync"; paused: boolean; position: number }
  | { v: 1; t: "ctl"; paused: boolean; position: number }
  | { v: 1; t: "stop" };

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
const link = (v: unknown) => {
  const s = str(v, 4000);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e7 ? v : undefined);

export function cleanPlayable(raw: unknown): Playable | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const url = link(p.url);
  const title = str(p.title, 300)?.trim();
  if (!url || !title || typeof p.live !== "boolean") return null;
  const item: Playable = { url, title, live: p.live };
  const alt = Array.isArray(p.alt) ? p.alt.map(link).filter((u): u is string => !!u).slice(0, 3) : [];
  if (alt.length) item.alt = alt;
  const subtitle = str(p.subtitle, 300);
  if (subtitle) item.subtitle = subtitle;
  const logo = link(p.logo);
  if (logo) item.logo = logo;
  const h = (p.headers ?? {}) as Record<string, unknown>;
  const ua = str(h.ua, 300);
  const ref = str(h.ref, 500);
  if (ua || ref) item.headers = { ...(ua && { ua }), ...(ref && { ref }) };
  return item;
}

export function parseWire(data: string): Wire | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || m.v !== 1) return null;
  switch (m.t) {
    case "hello":
    case "stop":
      return { v: 1, t: m.t };
    case "now": {
      const item = cleanPlayable(m.item);
      if (!item) return null;
      return { v: 1, t: "now", item, paused: m.paused === true, position: seconds(m.position) };
    }
    case "sync":
    case "ctl": {
      const position = seconds(m.position);
      if (position === undefined || typeof m.paused !== "boolean") return null;
      return { v: 1, t: m.t, paused: m.paused, position };
    }
  }
  return null;
}

/** For sending: only what the others need (no guide ids, nothing of the list itself). */
export function shareable(item: Playable): Playable {
  return cleanPlayable(item) ?? item;
}

/** How far a viewer's film may drift from the host's before it's snapped back. */
export const DRIFT_S = 2;

/** Where the host's film should be now, given where it was when the message arrived. */
export function expectedPosition(sync: { paused: boolean; position: number; receivedAt: number }, now: number): number {
  return sync.paused ? sync.position : sync.position + (now - sync.receivedAt) / 1000;
}
