/**
 * Getting an IPTV link to play in a <video>: HLS through hls.js (Safari plays it natively), MPEG-TS through
 * mpegts.js, files (mp4, mkv, webm) natively. Links often don't say what they are, and a server may refuse
 * the browser and accept the relay, so a link becomes a list of attempts tried in order.
 */
import type Hls from "hls.js";
import { blockedAsMixed, isOwn, relay } from "./net";
import type { Playable } from "./types";

export type EngineName = "hls" | "mpegts" | "native";

export interface Attempt {
  url: string;
  engine: EngineName;
  proxied: boolean;
}

export function guessEngine(url: string): EngineName | null {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname.toLowerCase();
    const output = u.searchParams.get("output")?.toLowerCase();
    if (output === "hls" || output === "m3u8") return "hls";
    if (output === "ts" || output === "mpegts") return "mpegts";
  } catch {
    return null;
  }
  if (/\.m3u8?$/.test(path)) return "hls";
  if (/\.(ts|mts|m2ts)$/.test(path)) return "mpegts";
  if (/\.(mp4|m4v|mkv|webm|mov|ogv|mp3|aac|m4a)$/.test(path)) return "native";
  return null;
}

const MAX_ATTEMPTS = 6;

export function attemptsFor(play: Playable): Attempt[] {
  const out: Attempt[] = [];
  for (const url of [play.url, ...(play.alt ?? [])]) {
    const guess = guessEngine(url);
    // No extension: IPTV links like that are almost always MPEG-TS; HLS is the next best bet.
    const engines: EngineName[] = guess === "native" ? ["native"] : guess ? [guess] : play.live ? ["mpegts", "hls"] : ["native", "mpegts"];
    for (const engine of engines) {
      // hls.js and mpegts.js fetch with CORS, which IPTV servers don't answer; headers can only be set by the relay.
      const direct = !blockedAsMixed(url) && !play.headers && (engine === "native" || /^https:/i.test(url));
      if (direct) out.push({ url, engine, proxied: false });
      out.push({ url, engine, proxied: true });
    }
  }
  return out.slice(0, MAX_ATTEMPTS);
}

export interface Attached {
  destroy(): void;
}

/**
 * Wires one attempt to the video. `onFatal` fires at most once, with a reason to show; the caller moves on
 * to the next attempt.
 */
export async function attach(video: HTMLVideoElement, attempt: Attempt, play: Playable, onFatal: (reason: string) => void): Promise<Attached> {
  const shared = play.live && attempt.engine === "mpegts";
  const src = attempt.proxied ? relay("stream", attempt.url, play.headers, shared) : attempt.url;
  let failed = false;
  const fatal = (reason: string) => {
    if (!failed) (failed = true), onFatal(reason);
  };

  if (attempt.engine === "hls") {
    const { default: HlsClass } = await import("hls.js");
    if (!HlsClass.isSupported()) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) return native(video, src, fatal);
      fatal("Este navegador não toca HLS");
      return { destroy() {} };
    }
    // Short manifest timeouts: a dead channel should move on to the next attempt (or say so) quickly.
    const hls: Hls = new HlsClass({
      enableWorker: true,
      liveSyncDurationCount: 3,
      manifestLoadingTimeOut: 8000,
      manifestLoadingMaxRetry: 0,
      levelLoadingMaxRetry: 2,
    });
    let recovered = false;
    hls.on(HlsClass.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true;
        hls.recoverMediaError();
        return;
      }
      fatal(data.type === HlsClass.ErrorTypes.NETWORK_ERROR ? "O servidor não entregou o canal" : "O vídeo veio num formato que não deu pra tocar");
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    return { destroy: () => hls.destroy() };
  }

  if (attempt.engine === "mpegts") {
    const { default: mpegts } = await import("mpegts.js");
    if (!mpegts.isSupported()) {
      fatal("Este navegador não toca MPEG-TS");
      return { destroy() {} };
    }
    // IPTV panels send live channels in bursts (seconds of video at once, then a trickle). Chasing the live edge
    // turns that into jumps ahead and then stalls; instead playback runs a touch faster only when far behind.
    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: play.live, url: src },
      {
        enableWorker: true,
        lazyLoad: false,
        enableStashBuffer: true,
        stashInitialSize: 1024 * 1024,
        liveBufferLatencyChasing: false,
        liveSync: play.live,
        liveSyncMaxLatency: 20,
        liveSyncTargetLatency: 10,
        liveSyncPlaybackRate: 1.05,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 30,
      },
    );
    player.on(mpegts.Events.ERROR, (type: string) =>
      fatal(type === mpegts.ErrorTypes.NETWORK_ERROR ? "O servidor não entregou o canal" : "O vídeo veio num formato que não deu pra tocar"),
    );
    player.attachMediaElement(video);
    player.load();
    return {
      destroy: () => {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      },
    };
  }

  return native(video, src, fatal);
}

function native(video: HTMLVideoElement, src: string, fatal: (reason: string) => void): Attached {
  const probe = new AbortController();
  const onError = () => {
    const code = video.error?.code;
    if (code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return fatal("Não deu pra carregar o vídeo");
    // The browser says "unsupported source" for an error page too (the list refused it, the server couldn't reach it):
    // ask our server what happened before blaming the format.
    void whyNot(src, probe.signal).then((why) => !probe.signal.aborted && fatal(why ?? "O navegador não abre esse formato"));
  };
  video.addEventListener("error", onError);
  video.src = src;
  return {
    destroy: () => {
      probe.abort();
      video.removeEventListener("error", onError);
      video.removeAttribute("src");
      video.load();
    },
  };
}

/** For a source through our server: its error message, or null when it does send a video (then it is the format). */
export async function whyNot(src: string, signal: AbortSignal): Promise<string | null> {
  if (!isOwn(src)) return null;
  try {
    const res = await fetch(src, { signal, cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && !type.includes("json") && !type.includes("html")) {
      void res.body?.cancel();
      return null;
    }
    const body = await res.text();
    const error = type.includes("json") ? (JSON.parse(body) as { error?: string }).error : undefined;
    return error ?? (res.ok ? "A lista mandou uma página no lugar do vídeo" : `O servidor da lista respondeu ${res.status}`);
  } catch {
    return null;
  }
}
