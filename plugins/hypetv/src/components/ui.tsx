import { Clapperboard, Film, Tv, type LucideIcon } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { isTmdbImage, useArt } from "../lib/art";
import { imageUrl } from "../lib/net";
import type { Kind } from "../lib/types";

/** The HypeMeet button family as the app ships it: pills with a sticker edge. */
type Variant = "primary" | "ghost" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "border-accent-hi bg-accent text-on-accent hover:bg-accent-hi",
  ghost: "border-line bg-surface text-ink hover:bg-surface-hi",
  danger: "border-danger bg-danger text-on-accent hover:brightness-110",
  quiet: "border-transparent text-soft shadow-none! hover:bg-surface-hi hover:text-ink",
};

export function buttonClass({ variant = "ghost", size = "md", square = false }: { variant?: Variant; size?: "sm" | "md"; square?: boolean } = {}) {
  const box = size === "sm" ? (square ? "size-10" : "h-10 px-4") : square ? "size-12" : "h-12 px-5";
  return `${size === "sm" ? "type-link-sm" : "type-link"} inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 shadow-sticker transition duration-200 ease-out-expo hover:-translate-y-px active:translate-y-px active:shadow-none disabled:translate-y-0 disabled:opacity-50 ${box} ${VARIANTS[variant]}`;
}

export function Button({
  variant = "ghost",
  size = "md",
  square = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; square?: boolean }) {
  return <button type="button" {...props} className={`${buttonClass({ variant, size, square })} ${className}`} />;
}

/** Icon-only control in bars and headers. */
export const iconButtonClass =
  "grid size-9 shrink-0 place-items-center rounded-full text-soft transition hover:bg-surface-hi hover:text-ink disabled:opacity-40";

export function Spinner({ className = "size-5" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`} />;
}

export const inputClass =
  "h-12 w-full rounded-md border-2 border-line bg-surface px-4 text-[15px] font-medium text-ink placeholder:text-soft outline-none transition focus:border-accent";

/** A labelled input, as on the app's lobby: bold label above, optional leading icon and trailing control. */
export function Field({
  label,
  htmlFor,
  icon: Icon,
  trailing,
  children,
}: {
  label: string;
  htmlFor: string;
  icon?: LucideIcon;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="px-0.5 text-sm font-bold text-ink">
        {label}
      </label>
      <div className="flex gap-2">
        <div className={`relative min-w-0 flex-1 ${Icon ? "[&>input]:pl-11" : ""}`}>
          {Icon && <Icon className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-soft" />}
          {children}
        </div>
        {trailing}
      </div>
    </div>
  );
}

/** Names for icon-only tabs (the kinds on narrow screens). */
const KIND_ARIA: Record<string, string> = { live: "Ao vivo", movie: "Filmes", series: "Séries" };

/** Pill tabs, like the lobby's Criar / Entrar. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
  label,
  fit = false,
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  className?: string;
  label: string;
  /** Tabs as wide as their labels, instead of sharing the width. */
  fit?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 rounded-full border-2 border-line bg-surface p-1 ${className}`}>
      {options.map(({ value: v, label: text, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-label={text ? undefined : (KIND_ARIA[v] ?? v)}
          aria-selected={v === value}
          onClick={() => onChange(v)}
          className={`type-link-sm flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 whitespace-nowrap transition ${fit ? "flex-none" : "min-w-0 flex-1"} ${v === value ? "bg-accent text-on-accent shadow-[inset_0_0_0_2px_var(--color-accent-hi)]" : "text-soft hover:text-ink"}`}
        >
          {Icon && <Icon className="size-4 shrink-0" />}
          {text && <span className="truncate">{text}</span>}
        </button>
      ))}
    </div>
  );
}

export function initials(name: string, max = 2) {
  return (
    name
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, max)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** A person in the room (the plugin SDK gives a Discord avatar when there is one). */
export function Face({ name, image, className = "size-6 text-[10px]" }: { name: string; image?: string; className?: string }) {
  if (image) return <img src={image} alt="" className={`shrink-0 rounded-full bg-surface-hi object-cover ${className}`} />;
  return <span className={`grid shrink-0 place-items-center rounded-full bg-accent font-display font-extrabold text-on-accent ${className}`}>{initials(name)}</span>;
}

export function LiveBadge() {
  return <span className="shrink-0 rounded-xs bg-danger px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-on-accent">AO VIVO</span>;
}

/** Without the noise lists hang on names, for the last-resort title cards. */
const shortName = (name: string) =>
  name
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/\b(f?hd|sd|uhd|4k|h\.?26[45]|hevc|alt)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || name;

/**
 * A channel logo, film poster or episode still. The list's own image is often missing or on a host that breaks,
 * so channels get the official logo (iptv-org) and films and series a real poster (TMDB, Wikipedia) from the
 * server, falling back to the list's image, through the relay when it fails directly. Only when nothing at all
 * exists is a title card drawn.
 */
export function Art({
  kind,
  name,
  src,
  year,
  tvgId,
  shape,
  className = "",
}: {
  kind: Kind;
  name: string;
  /** The list's own image. */
  src?: string;
  year?: string;
  tvgId?: string;
  /** logo: contained on a tile; poster/still: cover. */
  shape: "logo" | "poster" | "still";
  className?: string;
}) {
  const own = src && /^https?:\/\//i.test(src) ? src : undefined;
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  // A TMDB poster is what a lookup would find: no need to ask, unless it fails.
  const trustOwn = kind !== "live" && isTmdbImage(own);
  const lookup = !trustOwn || (!!own && broken.has(own));
  const art = useArt(lookup ? { kind, name, year, tvgId } : null);
  const found = art ? [art.image, ...(art.alts ?? [])] : [];
  const candidates = trustOwn ? [own, ...found] : [...found, own];
  const url = candidates.find((u): u is string => !!u && !broken.has(u));
  const fail = (u: string) => setBroken((b) => new Set(b).add(u));

  if (!url && lookup && art === undefined) return <div className={`shrink-0 animate-pulse bg-surface-hi ${className}`} />;
  if (url)
    return (
      <img
        key={url}
        src={imageUrl(url, shape === "poster" ? "w342" : shape === "still" ? "w500" : undefined)}
        alt=""
        // The grids only render what's on screen: no need for the browser's own (and slower) lazy loading.
        loading="eager"
        decoding="async"
        draggable={false}
        onError={() => fail(url)}
        className={`shrink-0 bg-surface-hi ${shape === "logo" ? "object-contain p-1.5" : "object-cover"} ${className}`}
      />
    );

  const Icon = kind === "live" ? Tv : kind === "series" ? Clapperboard : Film;
  if (shape === "logo")
    return (
      <div className={`grid shrink-0 place-items-center overflow-hidden bg-surface-hi px-1 ${className}`}>
        <span className="line-clamp-2 text-center font-display text-[11px] leading-[1.05] font-extrabold tracking-[-0.01em] text-ink/90 uppercase">{shortName(name)}</span>
      </div>
    );
  return (
    <div className={`flex shrink-0 flex-col justify-between overflow-hidden bg-surface-hi p-3 ${className}`}>
      <Icon className="size-5 text-accent-hi" />
      <span className="line-clamp-4 font-display text-[15px] leading-[1.1] font-extrabold tracking-[-0.01em] text-ink">{shortName(name)}</span>
    </div>
  );
}

/** "Hype" + the tilted accent pill, like the app's own Hype[Meet] wordmark. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-display leading-none font-extrabold tracking-[-0.02em] ${className}`}>
      Hype
      <span className="ml-[0.16em] inline-block -rotate-3 rounded-[0.38em] border-2 border-accent-hi bg-accent px-[0.36em] pt-[0.08em] pb-[0.18em] text-on-accent shadow-sticker">Tv</span>
    </span>
  );
}
