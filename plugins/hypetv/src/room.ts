import { connectToHost, type HostConnection, type PluginPerson } from "@hypemeet/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { DRIFT_S, expectedPosition, parseWire, shareable, type Wire } from "./lib/together";
import type { Playable } from "./lib/types";
import type { PlayerHandle } from "./components/Player";

/** One connection per page, even when React mounts twice in dev. */
let connecting: Promise<HostConnection> | null = null;

export interface Host {
  conn: HostConnection | null;
  /** solo: opened outside a room (dev, or straight in the browser); everything but watching together works. */
  status: "connecting" | "room" | "solo";
  people: PluginPerson[];
}

export function useHost(): Host {
  const [state, setState] = useState<Host>({ conn: null, status: "connecting", people: [] });
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    (connecting ??= connectToHost(6000)).then(
      (conn) => {
        if (!alive) return;
        setState({ conn, status: "room", people: conn.people });
        off = conn.on("people", (people) => setState((s) => ({ ...s, people })));
      },
      () => alive && setState((s) => ({ ...s, status: "solo" })),
    );
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return state;
}

export interface Broadcast {
  item: Playable;
  by: string;
  name: string;
  avatar?: string;
}

export interface Together {
  broadcast: Broadcast | null;
  hosting: boolean;
  following: boolean;
  /** Who else has the plugin open (could watch along). */
  audience: PluginPerson[];
  pass(item: Playable): void;
  stopPassing(): void;
  follow(): void;
  unfollow(): void;
  /** Something picked here: while passing, the room follows; while following, we drop out. */
  pickedLocally(item: Playable): void;
}

const SYNC_EVERY_MS = 5000;
const CHECK_EVERY_MS = 2000;

/**
 * Passing a channel or film to the room, and watching what someone else passes. See lib/together.ts for the
 * messages. `onFollow` plays an item from the room.
 */
export function useTogether(host: Host, player: PlayerHandle, onFollow: (item: Playable) => void): Together {
  const { conn, people } = host;
  const self = conn?.self ?? "";
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [following, setFollowing] = useState(false);
  /** The host's film, as last heard (followers). */
  const sync = useRef<{ paused: boolean; position: number; receivedAt: number } | null>(null);
  const latest = useRef({ broadcast, following, people, onFollow });
  latest.current = { broadcast, following, people, onFollow };
  const hosting = !!broadcast && broadcast.by === self;

  const send = useCallback(
    (msg: Wire, to?: string[]) => conn?.send(JSON.stringify(msg), to ? { to } : undefined),
    [conn],
  );

  const playback = useCallback(() => {
    const v = player.video;
    return v ? { paused: v.paused, position: Number.isFinite(v.currentTime) ? v.currentTime : 0 } : { paused: false, position: 0 };
  }, [player]);

  /** Follower: bring our film to where the host's is. */
  const applySync = useCallback(() => {
    const v = player.video;
    const s = sync.current;
    if (!v || !s || v.readyState < 1) return;
    const expected = expectedPosition(s, performance.now());
    if (Math.abs(v.currentTime - expected) > DRIFT_S && (!Number.isFinite(v.duration) || expected < v.duration)) {
      player.quietSeek = true;
      v.currentTime = expected;
    }
    if (s.paused !== v.paused) {
      player.quietUntil = performance.now() + 900;
      if (s.paused) v.pause();
      else v.play().catch((err: Error) => err.name === "NotAllowedError" && player.blocked?.());
    }
  }, [player]);

  // Messages from the other copies of the plugin.
  useEffect(() => {
    if (!conn) return;
    const off = conn.on("message", (from, data) => {
      const msg = parseWire(data);
      if (!msg) return;
      const { broadcast: b, following: f, people: ps } = latest.current;
      switch (msg.t) {
        case "hello":
          if (b?.by === conn.self) send({ v: 1, t: "now", item: shareable(b.item), ...playback() }, [from]);
          return;
        case "now": {
          const person = ps.find((p) => p.identity === from);
          const wasIn = f || b?.by === conn.self;
          setBroadcast({ item: msg.item, by: from, name: person?.name ?? "Alguém", avatar: person?.avatar });
          sync.current = msg.item.live ? null : { paused: !!msg.paused, position: msg.position ?? 0, receivedAt: performance.now() };
          // Already watching the room (or passing it, now taken over): stay with it.
          if (wasIn) {
            setFollowing(true);
            latest.current.onFollow(msg.item);
          }
          return;
        }
        case "sync":
          if (from !== b?.by) return;
          sync.current = { paused: msg.paused, position: msg.position, receivedAt: performance.now() };
          if (f) applySync();
          return;
        case "ctl": {
          const v = player.video;
          if (b?.by !== conn.self || b.item.live || !v) return;
          // Not quiet: our own events then tell everyone (sync).
          if (Math.abs(v.currentTime - msg.position) > 1) v.currentTime = msg.position;
          if (msg.paused) v.pause();
          else void v.play().catch(() => undefined);
          return;
        }
        case "stop":
          if (from !== b?.by) return;
          setBroadcast(null);
          setFollowing(false);
          sync.current = null;
          return;
      }
    });
    send({ v: 1, t: "hello" });
    return off;
  }, [conn, send, playback, applySync, player]);

  // Whoever was passing closed the plugin or left.
  useEffect(() => {
    if (!broadcast || broadcast.by === self) return;
    const person = people.find((p) => p.identity === broadcast.by);
    if (!person || person.since === null) {
      setBroadcast(null);
      setFollowing(false);
      sync.current = null;
    }
  }, [people, broadcast, self]);

  // Host, film: tell the room on every play/pause/seek and every few seconds.
  const film = !!broadcast && !broadcast.item.live;
  useEffect(() => {
    const v = player.video;
    if (!hosting || !film || !v) return;
    const tell = () => send({ v: 1, t: "sync", ...playback() });
    const events = ["play", "pause", "seeked"] as const;
    for (const e of events) v.addEventListener(e, tell);
    const timer = setInterval(() => !v.paused && tell(), SYNC_EVERY_MS);
    return () => {
      for (const e of events) v.removeEventListener(e, tell);
      clearInterval(timer);
    };
  }, [hosting, film, player, send, playback]);

  // Follower, film: keep up with the host, and ask them when we pause/play/seek ourselves.
  useEffect(() => {
    const v = player.video;
    if (!following || !film || !v || !broadcast) return;
    const host = broadcast.by;
    const ask = (e: Event) => {
      if (e.type === "seeked" && player.quietSeek) {
        player.quietSeek = false;
        return;
      }
      if (e.type !== "seeked" && performance.now() < player.quietUntil) return;
      send({ v: 1, t: "ctl", ...playback() }, [host]);
    };
    const events = ["play", "pause", "seeked"] as const;
    for (const e of events) v.addEventListener(e, ask);
    v.addEventListener("loadedmetadata", applySync);
    v.addEventListener("canplay", applySync);
    const timer = setInterval(applySync, CHECK_EVERY_MS);
    applySync();
    return () => {
      for (const e of events) v.removeEventListener(e, ask);
      v.removeEventListener("loadedmetadata", applySync);
      v.removeEventListener("canplay", applySync);
      clearInterval(timer);
    };
  }, [following, film, broadcast, player, send, playback, applySync]);

  const pass = useCallback(
    (item: Playable) => {
      if (!conn) return;
      setBroadcast({ item, by: conn.self, name: "Você" });
      setFollowing(false);
      send({ v: 1, t: "now", item: shareable(item), ...(item.live ? {} : playback()) });
    },
    [conn, send, playback],
  );

  const stopPassing = useCallback(() => {
    if (!hosting) return;
    send({ v: 1, t: "stop" });
    setBroadcast(null);
  }, [hosting, send]);

  const follow = useCallback(() => {
    const b = latest.current.broadcast;
    if (!b || b.by === self) return;
    setFollowing(true);
    latest.current.onFollow(b.item);
  }, [self]);

  const unfollow = useCallback(() => setFollowing(false), []);

  const pickedLocally = useCallback(
    (item: Playable) => {
      if (hosting) pass(item);
      else if (latest.current.following) setFollowing(false);
    },
    [hosting, pass],
  );

  const audience = people.filter((p) => p.identity !== self && p.since !== null);
  return { broadcast, hosting, following, audience, pass, stopPassing, follow, unfollow, pickedLocally };
}
