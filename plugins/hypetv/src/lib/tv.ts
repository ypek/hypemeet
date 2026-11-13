/**
 * TV mode: HypeTv on Android TV (the APK in tv/android) and LG webOS (the IPK in tv/webos), driven by a remote.
 *
 * - Arrows move the focus to the nearest control in that direction (spatial navigation), so every button,
 *   card and row is reachable without a pointer; OK (Enter) presses it.
 * - Back walks back through what's open (player, page, search…) and leaves the app at the start.
 * - Media keys and CH+/CH- reach the player.
 *
 * Turned on by ?tv=1 (what both apps open), the webOS browser, or the Android app's user agent.
 */

export const isTv = (() => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  // The TV build (vite build --mode tv, served at /tv/) is always in TV mode.
  return import.meta.env.MODE === "tv" || new URLSearchParams(location.search).has("tv") || /Web0S|webOS|NetCast|HypeTvAndroidTV/i.test(ua);
})();

/** webOS and Android TV remote keys, as key names our handlers understand. */
const KEY_CODES: Record<number, string> = {
  461: "Back", // webOS Back
  10009: "Back", // Tizen, just in case
  415: "MediaPlay",
  19: "MediaPause",
  413: "MediaStop",
  412: "MediaRewind",
  417: "MediaFastForward",
  427: "ChannelUp",
  428: "ChannelDown",
};

export function remoteKey(e: KeyboardEvent): string {
  const named = KEY_CODES[e.keyCode];
  if (named) return named;
  if (e.key === "GoBack" || e.key === "BrowserBack") return "Back";
  // webOS sends CH+/CH- as PageUp/PageDown; on a computer those keep their own meaning (Player.tsx).
  if (isTv && e.key === "PageUp") return "ChannelUp";
  if (isTv && e.key === "PageDown") return "ChannelDown";
  return e.key;
}

const PLAYER_KEYS = new Set(["MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop", "MediaFastForward", "MediaRewind", "ChannelUp", "ChannelDown"]);

/** A media or channel key nobody handled reaches the player, wherever the focus is (browsing beside it, say). */
function forwardToPlayer(key: string, from: EventTarget | null): void {
  const player = document.querySelector<HTMLElement>("[data-player]");
  if (!player || (from instanceof Node && player.contains(from))) return;
  player.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/**
 * The Android app's way in for the keys its WebView keeps to itself (media, channels): a keydown with that key
 * name on whatever has the focus.
 */
function pageKey(key: string): void {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

// ---- Back: a stack of "close the thing on top" handlers -------------------------------------------------------

type BackHandler = () => boolean;
const backStack: BackHandler[] = [];

/** Registers a handler for Back; it returns true when it closed something. The last registered runs first. */
export function onBack(handler: BackHandler): () => void {
  backStack.push(handler);
  return () => {
    const i = backStack.lastIndexOf(handler);
    if (i !== -1) backStack.splice(i, 1);
  };
}

/** Runs Back: true when something closed, false when there's nothing left (the app may exit). */
export function goBack(): boolean {
  for (let i = backStack.length - 1; i >= 0; i--) if (backStack[i]!()) return true;
  return false;
}

/**
 * Leaves the app: on webOS back to the launcher (what LG asks of Back at an app's start; the runtime gives every app
 * webOSSystem, or PalmSystem on older TVs). The Android app finishes by itself when Back isn't handled.
 */
function exitApp() {
  type Platform = { platformBack?: () => void };
  const w = window as unknown as { webOSSystem?: Platform; PalmSystem?: Platform; webOS?: Platform };
  const platform = [w.webOSSystem, w.PalmSystem, w.webOS].find((p) => typeof p?.platformBack === "function");
  if (platform) platform.platformBack!();
  else window.close();
}

// ---- Spatial navigation ------------------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
  if (el.closest("[inert], [aria-hidden='true']")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * The best control in a direction: ahead of the current one, scored by distance along the direction plus a heavy
 * penalty for drifting sideways, so a grid moves cell by cell and a list row by row.
 */
export function nextInDirection(from: DOMRect, dir: Dir, candidates: { el: HTMLElement; rect: DOMRect }[]): HTMLElement | null {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, rect } of candidates) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let along: number;
    let across: number;
    switch (dir) {
      case "ArrowDown":
        along = rect.top - from.bottom;
        across = Math.abs(cx - fx);
        if (cy <= fy + 1) continue;
        break;
      case "ArrowUp":
        along = from.top - rect.bottom;
        across = Math.abs(cx - fx);
        if (cy >= fy - 1) continue;
        break;
      case "ArrowRight":
        along = rect.left - from.right;
        across = Math.abs(cy - fy);
        if (cx <= fx + 1) continue;
        break;
      case "ArrowLeft":
        along = from.left - rect.right;
        across = Math.abs(cy - fy);
        if (cx >= fx - 1) continue;
        break;
    }
    const score = Math.max(0, along) + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function moveFocus(dir: Dir): boolean {
  const current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  // An open overlay (the add-list dialog, a menu, the channel panel) keeps the focus inside it.
  const scopes = [...document.querySelectorAll<HTMLElement>("[data-tv-scope]")].filter(visible);
  const scope = (current?.closest("[data-tv-scope]") as HTMLElement | null) ?? scopes[scopes.length - 1] ?? document.body;
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el !== current && visible(el));
  if (!current) {
    // Lost the focus (what had it closed): start again from the section on screen in the sidebar.
    const start = (scope === document.body && document.querySelector<HTMLElement>('nav [aria-current="page"]')) || all[0];
    start?.focus();
    return !!start;
  }
  const target = nextInDirection(
    current.getBoundingClientRect(),
    dir,
    all.map((el) => ({ el, rect: el.getBoundingClientRect() })),
  );
  if (!target) {
    if (dir === "ArrowUp" && scope !== document.body && scope.tabIndex >= 0 && current !== scope) {
      scope.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

/** Text fields keep their own left/right (moving the caret) while they have text. */
function caretWantsIt(e: KeyboardEvent): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement) || !["text", "search", "url", "password", ""].includes(el.type)) return false;
  if (e.key === "ArrowLeft") return (el.selectionStart ?? 0) > 0;
  if (e.key === "ArrowRight") return (el.selectionEnd ?? 0) < el.value.length;
  return false;
}

/** The width the TV layout is made for: what reads well from the couch. */
const TV_LAYOUT_WIDTH = 1280;

/**
 * webOS draws apps at 1920×1080: zoom brings the layout back to its 1280 size, drawn at the screen's own resolution
 * (an app set to 1280×720 gets stretched by the TV instead, and its text looks blurry). Measured once, before zooming.
 */
export function zoomFor(width: number): number | null {
  const scale = width / TV_LAYOUT_WIDTH;
  return scale > 1.2 ? Math.round(scale * 100) / 100 : null;
}

/** Turns TV mode on: the class for the bigger focus rings, arrow navigation and the Back key. */
export function installTv() {
  if (!isTv) return;
  document.documentElement.classList.add("tv");
  const zoom = zoomFor(window.innerWidth);
  if (zoom) document.documentElement.style.setProperty("zoom", String(zoom));
  Object.assign(window, { hypetvBack: goBack, hypetvKey: pageKey });
  window.addEventListener(
    "keydown",
    (e) => {
      const key = remoteKey(e);
      if (key === "Back" || (key === "Escape" && !e.defaultPrevented) || (key === "Backspace" && !(document.activeElement instanceof HTMLInputElement))) {
        e.preventDefault();
        if (!goBack()) exitApp();
        return;
      }
      if (e.defaultPrevented) return;
      if (PLAYER_KEYS.has(key)) {
        e.preventDefault();
        forwardToPlayer(key, e.target);
        return;
      }
      const range = document.activeElement instanceof HTMLInputElement && document.activeElement.type === "range";
      if (range && (key === "ArrowLeft" || key === "ArrowRight")) return;
      if ((key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") && !caretWantsIt(e)) {
        if (moveFocus(key)) e.preventDefault();
      }
    },
    // After the components' own handlers (the player's arrows), which mark what they handled.
    false,
  );
  // Something to start from: the first section in the sidebar.
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) document.querySelector<HTMLElement>('nav [aria-current="page"], nav button')?.focus();
  });
}
