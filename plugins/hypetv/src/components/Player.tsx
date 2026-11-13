import { AlertTriangle, ChevronRight, Maximize, Minimize, Pause, PictureInPicture2, Play, RectangleHorizontal, RotateCcw, Shrink, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { attach, attemptsFor, type Attached } from "../lib/engine";
import { loadVolume, saveVolume } from "../lib/storage";
import { isTv, onBack, remoteKey } from "../lib/tv";
import type { Playable } from "../lib/types";
import { Button, LiveBadge, Spinner } from "./ui";

/**
 * What the watch-together sync (room.ts) shares with the player: the element, and the marks that tell our own
 * play/pause/seek apart from the viewer's.
 */
export interface PlayerHandle {
  video: HTMLVideoElement | null;
  /** play/pause events before this (performance.now) are ours. */
  quietUntil: number;
  /** The next "seeked" is ours. */
  quietSeek: boolean;
  /** The browser refused to start playing: ask for a click. */
  blocked?: () => void;
}

export const createHandle = (): PlayerHandle => ({ video: null, quietUntil: 0, quietSeek: false });

/** No first frame by then: the next attempt (relay, other format) gets its turn. */
const STALL_MS = 25_000;
const HIDE_CONTROLS_MS = 2800;

type Phase = "idle" | "loading" | "playing" | "error" | "blocked";

/** Seconds of live video in hand before starting, and before resuming once the buffer ran dry. */
const LIVE_START_S = 5;
const LIVE_RESUME_S = 8;
/** Never wait longer than this for that cushion: a slow channel still starts. */
const BUFFER_WAIT_MAX_MS = 12_000;

/** Seconds buffered ahead of the playhead. */
function bufferedAhead(v: HTMLVideoElement): number {
  const t = v.currentTime;
  for (let i = 0; i < v.buffered.length; i++) {
    const end = v.buffered.end(i);
    if (end > t) return end - Math.max(v.buffered.start(i), t);
  }
  return 0;
}

function whenBuffered(v: HTMLVideoElement, seconds: number, cancelled: () => boolean): Promise<void> {
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (cancelled() || bufferedAhead(v) >= seconds || performance.now() - started > BUFFER_WAIT_MAX_MS) resolve();
      else setTimeout(check, 200);
    };
    check();
  });
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const PROGRESS_EVERY_MS = 5000;

export function Player({
  play,
  handle,
  idle,
  actions,
  className = "",
  start: resumeAt,
  onStarted,
  onProgress,
  onZap,
  panel,
  onStall,
  theater = false,
  onTheater,
}: {
  play: Playable | null;
  handle: PlayerHandle;
  /** Shown while nothing is playing. */
  idle?: ReactNode;
  /** Right end of the control bar (watch together). */
  actions?: ReactNode;
  className?: string;
  /** Films: where to resume (seconds). */
  start?: number;
  /** Once per item, when it actually plays: only then does it count as watched recently (as IPTVnator does). */
  onStarted?: () => void;
  /** Films: position every few seconds and on pause, for resume and "continue watching". */
  onProgress?: (time: number, duration: number) => void;
  /** PageUp / PageDown: the previous / next channel. */
  onZap?: (delta: -1 | 1) => void;
  /** Live ran out of buffer (a slow connection, a struggling channel). */
  onStall?: () => void;
  /** Cinema mode: the picture fills the whole plugin, everything else out of the way. */
  theater?: boolean;
  onTheater?: (on: boolean) => void;
  /** IPTVnator's fullscreen channel panel: the list beside the picture, toggled with C. */
  panel?: (close: () => void) => ReactNode;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  // Back closes the channel list first.
  useEffect(() => (panelOpen ? onBack(() => (setPanelOpen(false), true)) : undefined), [panelOpen]);
  const latestCallbacks = useRef({ onStarted, onProgress, resumeAt, onStall });
  latestCallbacks.current = { onStarted, onProgress, resumeAt, onStall };
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [retry, setRetry] = useState(0);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** Where the knob is being dragged to (or was clicked), until it's let go. */
  const [scrub, setScrub] = useState<number | null>(null);
  /** A film waiting for data after a jump (or a hiccup): the spinner over the picture. */
  const [buffering, setBuffering] = useState(false);
  const [{ volume, muted }, setVolume] = useState(loadVolume);
  /** Autoplay with sound was refused, it plays muted until a click. */
  const [mutedByBrowser, setMutedByBrowser] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    handle.video = video.current;
    handle.blocked = () => setPhase("blocked");
    return () => {
      handle.video = null;
      handle.blocked = undefined;
    };
  }, [handle]);

  const start = useCallback(
    (v: HTMLVideoElement) => {
      handle.quietUntil = performance.now() + 1500;
      v.play().catch((err: Error) => {
        if (err.name !== "NotAllowedError") return;
        v.muted = true;
        v.play().then(
          () => setMutedByBrowser(true),
          () => setPhase("blocked"),
        );
      });
    },
    [handle],
  );

  const key = play ? `${play.url}\u0000${play.title}` : "";
  useEffect(() => {
    const v = video.current!;
    setMutedByBrowser(false);
    setTime(0);
    setDuration(0);
    if (!play) {
      setPhase("idle");
      return;
    }
    let cancelled = false;
    let current: Attached | null = null;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const list = attemptsFor(play);
    let index = 0;
    let lastReason = "Não deu pra abrir";
    let lastPos = 0;
    let retries = 0;

    const next = async (why?: string) => {
      if (cancelled) return;
      if (why) lastReason = why;
      clearTimeout(stall);
      current?.destroy();
      current = null;
      if (index >= list.length) {
        setPhase("error");
        setReason(lastReason);
        return;
      }
      // Already playing a film and the connection dropped (a slow link, a long wait after a jump): the same source
      // again, from where it was, a few times before giving up on it.
      let resumeFrom = 0;
      if (started && !play.live && index > 0 && retries < 3) {
        retries++;
        index--;
        resumeFrom = lastPos;
      }
      const attempt = list[index++]!;
      setPhase("loading");
      setStatus(resumeFrom ? "Reconectando…" : index > 1 ? (attempt.proxied ? "Tentando pelo proxy…" : "Tentando de outro jeito…") : play.live ? "Sintonizando…" : "Carregando…");
      try {
        current = await attach(v, attempt, play, (r) => void next(r));
      } catch {
        void next("O player não abriu");
        return;
      }
      if (cancelled) {
        current.destroy();
        return;
      }
      if (resumeFrom > 0)
        v.addEventListener(
          "loadedmetadata",
          () => {
            handle.quietSeek = true;
            v.currentTime = resumeFrom;
          },
          { once: true },
        );
      stall = setTimeout(() => void next(play.live ? "O canal não começou a tocar" : "O vídeo não começou a tocar"), STALL_MS);
      // Live: a few seconds in hand before starting ride out the panel's bursts and gaps.
      if (play.live) await whenBuffered(v, LIVE_START_S, () => cancelled);
      if (!cancelled) start(v);
    };
    const settled = () => clearTimeout(stall);
    let started = false;
    const onPlaying = () => {
      settled();
      setPhase("playing");
      if (!started) {
        started = true;
        latestCallbacks.current.onStarted?.();
      }
    };
    // Films: back to where we left off, once the duration is known.
    const resume = latestCallbacks.current.resumeAt;
    const onMetadata = () => {
      if (!play.live && resume && Number.isFinite(v.duration) && resume < v.duration - 10) {
        handle.quietSeek = true;
        v.currentTime = resume;
      }
    };
    v.addEventListener("loadedmetadata", onMetadata, { once: true });
    // Films: report the position now and then, and when paused or left.
    let lastReport = 0;
    const report = (force: boolean) => {
      if (play.live || !Number.isFinite(v.duration) || !v.duration || !started) return;
      if (!force && performance.now() - lastReport < PROGRESS_EVERY_MS) return;
      lastReport = performance.now();
      latestCallbacks.current.onProgress?.(v.currentTime, v.duration);
    };
    const onTime = () => {
      if (!play.live && v.currentTime > 1 && !v.seeking) lastPos = v.currentTime;
      report(false);
    };
    const onPause = () => report(true);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("pause", onPause);
    // Live ran dry: hold still until there's a cushion again, instead of stuttering frame by frame.
    let refilling = false;
    const onWaiting = async () => {
      if (!play.live || refilling || v.paused) return;
      refilling = true;
      latestCallbacks.current.onStall?.();
      setStatus("Carregando…");
      setPhase("loading");
      handle.quietUntil = performance.now() + 1000;
      v.pause();
      await whenBuffered(v, LIVE_RESUME_S, () => cancelled);
      refilling = false;
      if (!cancelled) start(v);
    };
    v.addEventListener("playing", onPlaying);
    v.addEventListener("loadeddata", settled);
    v.addEventListener("waiting", onWaiting);
    void next();
    return () => {
      report(true);
      cancelled = true;
      clearTimeout(stall);
      v.removeEventListener("loadedmetadata", onMetadata);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("loadeddata", settled);
      v.removeEventListener("waiting", onWaiting);
      current?.destroy();
    };
  }, [key, retry, start]);

  // Element state → React.
  useEffect(() => {
    const v = video.current!;
    const sync = () => {
      setPaused(v.paused);
      setTime(v.currentTime);
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    };
    // "seeking": currentTime already reads the target, so the bar shows where we're going, not where we were.
    const events = ["play", "pause", "timeupdate", "durationchange", "loadedmetadata", "seeking", "seeked"];
    for (const e of events) v.addEventListener(e, sync);
    const busy = () => setBuffering(true);
    const idle = () => setBuffering(false);
    const seeked = () => v.paused && setBuffering(false);
    v.addEventListener("seeking", busy);
    v.addEventListener("waiting", busy);
    v.addEventListener("playing", idle);
    v.addEventListener("pause", idle);
    v.addEventListener("seeked", seeked);
    v.addEventListener("emptied", idle);
    return () => {
      for (const e of events) v.removeEventListener(e, sync);
      v.removeEventListener("seeking", busy);
      v.removeEventListener("waiting", busy);
      v.removeEventListener("playing", idle);
      v.removeEventListener("pause", idle);
      v.removeEventListener("seeked", seeked);
      v.removeEventListener("emptied", idle);
    };
  }, []);

  useEffect(() => {
    const v = video.current!;
    v.volume = volume;
    if (!mutedByBrowser) v.muted = muted;
    saveVolume({ volume, muted });
  }, [volume, muted, mutedByBrowser]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const live = !!play?.live || (phase === "playing" && !duration);
  const toggle = () => {
    const v = video.current!;
    if (phase === "blocked") {
      setPhase("loading");
      start(v);
      return;
    }
    if (v.paused) start(v);
    else v.pause();
  };
  const unmute = () => {
    setMutedByBrowser(false);
    setVolume((s) => ({ ...s, muted: false }));
    video.current!.muted = false;
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => undefined);
  };
  const pip = () => {
    const v = video.current!;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void v.requestPictureInPicture().catch(() => undefined);
  };
  const seek = (to: number) => {
    const v = video.current!;
    if (!Number.isFinite(v.duration)) return;
    const target = Math.min(Math.max(0, to), v.duration);
    setTime(target);
    v.currentTime = target;
  };

  const poke = () => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useEffect(() => {
    if (isTv && theater) box.current?.focus({ preventScroll: true });
  }, [theater]);

  const onKey = (e: React.KeyboardEvent) => {
    // Any key shows the controls, so navigating them with a remote never lands on hidden buttons.
    poke();
    const remote = remoteKey(e.nativeEvent);
    if (remote === "MediaPlay" || remote === "MediaPause" || remote === "MediaPlayPause") {
      e.preventDefault();
      const paused = video.current?.paused ?? true;
      if (remote === "MediaPlayPause" || paused === (remote === "MediaPlay")) toggle();
      return;
    }
    if (remote === "MediaFastForward" || remote === "MediaRewind") {
      e.preventDefault();
      if (!live) seek(time + (remote === "MediaFastForward" ? 30 : -30));
      return;
    }
    if ((remote === "ChannelUp" || remote === "ChannelDown") && onZap) {
      e.preventDefault();
      // CH+ is the next channel in the list, as on a TV.
      onZap(remote === "ChannelUp" ? 1 : -1);
      return;
    }
    if (remote === "MediaStop" && onTheater && theater) {
      e.preventDefault();
      onTheater(false);
      return;
    }
    if ((e.target as HTMLElement).closest("input, button")) return;
    const k = e.key.toLowerCase();
    // On a TV: OK plays/pauses; on a live channel up/down zap and left opens the channel list; on a film
    // up/down are left to the remote's focus (to reach the controls).
    if (isTv && k === "enter") toggle();
    else if (isTv && live && (k === "arrowup" || k === "arrowdown") && onZap) onZap(k === "arrowup" ? -1 : 1);
    else if (isTv && live && k === "arrowleft" && panel) setPanelOpen(true);
    else if (isTv && (k === "arrowup" || k === "arrowdown")) return;
    else if (k === " " || k === "k") toggle();
    else if (k === "m") setVolume((s) => ({ ...s, muted: !s.muted }));
    else if (k === "f") toggleFullscreen();
    else if (k === "arrowright" && !live) seek(time + 10);
    else if (k === "arrowleft" && !live) seek(time - 10);
    else if (k === "arrowup") setVolume((s) => ({ volume: Math.min(1, s.volume + 0.05), muted: false }));
    else if (k === "arrowdown") setVolume((s) => ({ ...s, volume: Math.max(0, s.volume - 0.05) }));
    else if (k === "pageup" && onZap) onZap(-1);
    else if (k === "pagedown" && onZap) onZap(1);
    else if (k === "c" && panel) setPanelOpen((o) => !o);
    else if (k === "escape" && panelOpen) setPanelOpen(false);
    else if (k === "escape" && theater && onTheater) onTheater(false);
    else if (k === "t" && onTheater) onTheater(!theater);
    else return;
    e.preventDefault();
    poke();
  };

  const silent = muted || mutedByBrowser || volume === 0;
  const VolumeIcon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const showControls = !!play && (controls || paused || phase !== "playing");
  const control = "grid size-9 shrink-0 place-items-center rounded-full text-ink transition hover:bg-white/15";
  const shownTime = scrub ?? time;
  const progress = duration ? (shownTime / duration) * 100 : 0;
  const commitScrub = () => {
    if (scrub === null) return;
    seek(scrub);
    setScrub(null);
  };

  return (
    <div
      ref={box}
      tabIndex={0}
      data-player=""
      data-tv-scope={theater ? "" : undefined}
      onKeyDown={onKey}
      onMouseMove={poke}
      onMouseLeave={() => setControls(false)}
      className={`group relative isolate overflow-hidden bg-black focus-visible:outline-offset-0 ${showControls ? "" : "cursor-none"} ${className}`}
    >
      <video
        ref={video}
        playsInline
        onClick={() => play && phase !== "error" && toggle()}
        onDoubleClick={toggleFullscreen}
        className={`absolute inset-0 size-full object-contain ${play ? "" : "invisible"}`}
      />

      {!play && <div className="absolute inset-0">{idle}</div>}

      {play && phase === "playing" && buffering && !play.live && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="flex animate-fade-in flex-col items-center gap-2 rounded-lg bg-scrim px-5 py-4 text-soft backdrop-blur-md">
            <Spinner className="size-8 text-accent-hi" />
            <p className="text-sm font-semibold text-ink">Carregando…</p>
          </div>
        </div>
      )}

      {play && phase === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-soft">
            <Spinner className="size-8 text-accent-hi" />
            <p className="text-sm">{status}</p>
          </div>
        </div>
      )}

      {play && phase === "error" && (
        <div className="bg-canvas absolute inset-0 z-10 grid place-items-center p-6 text-center">
          <div className="flex max-w-sm animate-pop flex-col items-center gap-3">
            <AlertTriangle className="size-9 text-warn" />
            <p className="type-link">{reason}</p>
            <p className="text-sm text-soft">Pode ser o canal fora do ar, o limite de conexões da sua lista ou um formato que o navegador não abre.</p>
            <Button variant="primary" size="sm" onClick={() => setRetry((n) => n + 1)} className="mt-1">
              <RotateCcw className="size-4" /> Tentar de novo
            </Button>
          </div>
        </div>
      )}

      {play && phase === "blocked" && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/70">
          <button
            type="button"
            onClick={toggle}
            className="type-link flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-on-accent shadow-float transition duration-200 ease-out-expo hover:brightness-110 active:scale-95"
          >
            <Play className="size-5 fill-current" /> Toque pra assistir
          </button>
        </div>
      )}

      {/* Full screen: what's on, top left (IPTVnator's title overlay). */}
      {play && (fullscreen || theater) && showControls && (
        <div className="pointer-events-none absolute top-4 left-4 z-20 flex max-w-[60%] animate-fade-in flex-col rounded-md bg-scrim px-3.5 py-2 backdrop-blur-md">
          <span className="truncate font-display text-lg font-extrabold">{play.title}</span>
          {play.subtitle && <span className="truncate text-xs text-soft">{play.subtitle}</span>}
        </div>
      )}

      {panel && panelOpen && (
        <div data-tv-scope="" className="absolute inset-y-0 left-0 z-30 flex w-[min(22rem,85%)] animate-fade-in flex-col border-r-2 border-line bg-panel/95 backdrop-blur-xl">
          {panel(() => setPanelOpen(false))}
        </div>
      )}
      {panel && !panelOpen && play && showControls && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          title="Canais (C)"
          aria-label="Abrir a lista de canais"
          className="absolute top-1/2 left-0 z-20 grid h-16 w-6 -translate-y-1/2 place-items-center rounded-r-md border-2 border-l-0 border-line bg-panel/90 text-soft transition hover:w-8 hover:text-ink"
        >
          <ChevronRight className="size-4" />
        </button>
      )}

      {mutedByBrowser && phase === "playing" && (
        <button
          type="button"
          onClick={unmute}
          className="type-link-sm absolute top-3 left-1/2 z-20 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-full bg-accent px-4 py-2 text-on-accent shadow-float hover:brightness-110"
        >
          <VolumeX className="size-4" /> Ativar o som
        </button>
      )}

      {play && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1.5 bg-linear-to-t from-black/90 via-black/55 to-transparent px-3 pt-14 pb-2.5 transition duration-200 ${showControls ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          {!live && (
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.5}
              value={Math.min(shownTime, duration || 0)}
              disabled={!duration}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commitScrub}
              onTouchEnd={commitScrub}
              onKeyUp={commitScrub}
              onBlur={commitScrub}
              aria-label="Posição"
              style={{ "--fill": `${progress}%` } as CSSProperties}
              className="range-accent w-full disabled:opacity-50"
            />
          )}
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggle} aria-label={paused ? "Reproduzir" : "Pausar"} className={control}>
              {paused ? <Play className="size-5 fill-current" /> : <Pause className="size-5 fill-current" />}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => (mutedByBrowser ? unmute() : setVolume((s) => ({ ...s, muted: !s.muted })))}
                aria-label={silent ? "Ativar som" : "Silenciar"}
                className={control}
              >
                <VolumeIcon className={`size-4 ${silent ? "text-danger" : ""}`} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={silent ? 0 : volume}
                onChange={(e) => {
                  setMutedByBrowser(false);
                  setVolume({ volume: Number(e.target.value), muted: false });
                }}
                aria-label="Volume"
                style={{ "--fill": `${(silent ? 0 : volume) * 100}%` } as CSSProperties}
                className="range-accent hidden w-20 sm:block"
              />
            </div>
            {live ? (
              <span className="ml-1.5">
                <LiveBadge />
              </span>
            ) : (
              <span className="px-1.5 text-xs font-semibold text-ink/90 tabular-nums">
                {formatTime(shownTime)} <span className="text-ink/50">/ {formatTime(duration)}</span>
              </span>
            )}
            <span className="min-w-0 flex-1" />
            {actions}
            {onTheater && (
              <button
                type="button"
                onClick={() => onTheater(!theater)}
                aria-label={theater ? "Sair do modo cinema" : "Modo cinema"}
                title={theater ? "Sair do modo cinema (T)" : "Modo cinema (T)"}
                className={control}
              >
                {theater ? <Shrink className="size-4" /> : <RectangleHorizontal className="size-4" />}
              </button>
            )}
            {document.pictureInPictureEnabled && (
              <button type="button" onClick={pip} aria-label="Janela flutuante" title="Janela flutuante" className={control}>
                <PictureInPicture2 className="size-4" />
              </button>
            )}
            {document.fullscreenEnabled && (
              <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} className={control}>
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
