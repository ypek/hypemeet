import { ChevronLeft, ChevronRight, Clapperboard, Film, Heart, History, Info, Play, Star, Tv } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useArt } from "../lib/art";
import { imageUrl } from "../lib/net";
import type { TitleInfo, Xtream } from "../lib/xtream";
import { cleanLabel } from "./Rail";
import { inProgress, type Progress } from "../lib/storage";
import type { Catalog, CatalogItem, Kind } from "../lib/types";
import { Art, Button, LiveBadge, Spinner } from "./ui";

const RAIL_MAX = 24;

/** Every loaded item by key, across kinds (favourites and recents can be any of them). */
export function useIndex(catalog: Catalog) {
  return useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const kind of ["live", "movie", "series"] as const) for (const item of catalog[kind]?.items ?? []) if (!map.has(item.key)) map.set(item.key, item);
    return map;
  }, [catalog]);
}

/** A title without the year lists repeat in it ("Quem Ama Cuida (2026) (2026)"): the year goes on its own line. */
export const titleOf = (name: string) => name.replace(/\s*\((19|20)\d{2}\)/g, "").trim() || name;

/**
 * A horizontal rail. The scroller sits inside the page's margins (cards never slide against the sidebar), fades
 * at its edges, and has arrows to page through it.
 */
function Rail({ title, icon: Icon, children, loading }: { title: string; icon: typeof Film; children: ReactNode; loading?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = () => {
    const el = scroller.current;
    if (el) setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  };
  useEffect(measure);
  const page = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: "smooth" });
  const arrow = "absolute top-[calc(50%-1.25rem)] z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border-2 border-line bg-panel/95 text-ink shadow-float backdrop-blur-md transition hover:bg-surface-hi disabled:pointer-events-none disabled:opacity-0";
  const mask = `linear-gradient(to right, ${edges.start ? "black" : "transparent"} 0, black 40px, black calc(100% - 40px), ${edges.end ? "black" : "transparent"} 100%)`;
  return (
    <section className="group/rail flex flex-col gap-3 px-5 sm:px-7">
      <h2 className="flex items-center gap-2 font-display text-lg font-extrabold tracking-[-0.01em]">
        <Icon className="size-5 text-accent-hi" /> {title}
        {loading && <Spinner className="size-4 text-soft" />}
      </h2>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={measure}
          style={{ maskImage: mask, WebkitMaskImage: mask }}
          className="flex snap-x snap-mandatory scroll-px-1 gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </div>
        <button type="button" onClick={() => page(-1)} disabled={edges.start} aria-label="Anteriores" className={`${arrow} -left-3 opacity-0 group-hover/rail:opacity-100`}>
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" onClick={() => page(1)} disabled={edges.end} aria-label="Próximos" className={`${arrow} -right-3 opacity-0 group-hover/rail:opacity-100`}>
          <ChevronRight className="size-5" />
        </button>
      </div>
    </section>
  );
}

export function PosterTile({ item, progress, onOpen, width = "w-36" }: { item: CatalogItem; progress?: Progress; onOpen: () => void; width?: string }) {
  const year = item.info?.year ?? /\((19|20)\d{2}\)/.exec(item.name)?.[0].slice(1, 5);
  const rating = Number(item.info?.rating) || 0;
  return (
    <button type="button" onClick={onOpen} className={`group/tile flex shrink-0 snap-start flex-col gap-2 text-left ${width}`}>
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md border-2 border-line transition duration-200 ease-out-expo group-hover/tile:-translate-y-1 group-hover/tile:border-accent group-hover/tile:shadow-float">
        <Art kind={item.kind} name={item.name} src={item.logo} year={item.info?.year} shape="poster" className="size-full" />
        {progress && (
          <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60">
            <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (progress.t / progress.d) * 100)}%` }} />
          </span>
        )}
      </div>
      <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="line-clamp-2 text-[13px] leading-tight font-bold">{titleOf(item.name)}</span>
        {(year || rating > 0) && (
          <span className="flex items-center gap-1.5 text-[11px] text-soft">
            {year}
            {rating > 0 && (
              <>
                {year && <span aria-hidden>·</span>}
                <Star className="size-3 fill-warn text-warn" /> {rating.toFixed(1).replace(".", ",")}
              </>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export function ChannelTile({ item, onPlay, width = "w-40" }: { item: CatalogItem; onPlay: () => void; width?: string }) {
  return (
    <button type="button" onClick={onPlay} className={`group/tile flex shrink-0 snap-start flex-col gap-1.5 text-left ${width}`}>
      <div className="relative aspect-video w-full overflow-hidden rounded-md border-2 border-line bg-surface-hi transition group-hover/tile:-translate-y-0.5 group-hover/tile:border-accent">
        <Art kind="live" name={item.name} src={item.logo} tvgId={item.tvgId} shape="logo" className="size-full p-3!" />
        <span className="absolute top-1.5 left-1.5">
          <LiveBadge />
        </span>
      </div>
      <span className="truncate text-[13px] font-bold">{item.name}</span>
      <span className="-mt-1 truncate text-[11px] text-soft">{cleanLabel(item.group)}</span>
    </button>
  );
}

/** "Continuar assistindo": an episode or film from the progress record, resumed straight away. */
function ResumeTile({ entry, onResume }: { entry: Progress; onResume: () => void }) {
  const kind: Kind = entry.owner?.kind ?? "movie";
  const name = entry.owner?.name ?? entry.play.title;
  const left = Math.max(1, Math.round((entry.d - entry.t) / 60));
  return (
    <button type="button" onClick={onResume} className="group/tile flex w-60 shrink-0 snap-start flex-col gap-1.5 text-left">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border-2 border-line transition group-hover/tile:-translate-y-0.5 group-hover/tile:border-accent">
        <Art kind={kind} name={name} src={entry.play.logo ?? entry.owner?.poster} shape="still" className="size-full" />
        <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover/tile:opacity-100">
          <span className="grid size-11 place-items-center rounded-full border-2 border-accent-hi bg-accent text-on-accent shadow-sticker">
            <Play className="size-5 fill-current" />
          </span>
        </span>
        <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60">
          <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (entry.t / entry.d) * 100)}%` }} />
        </span>
      </div>
      <span className="truncate text-[13px] font-bold">{name}</span>
      <span className="-mt-1 truncate text-[11px] text-soft">
        {entry.owner?.kind === "series" ? `${entry.play.title.split(" · ").pop()} · ` : ""}faltam {left} min
      </span>
    </button>
  );
}

/** The dashboard's hero (IPTVnator's): the newest film, with its backdrop, facts and plot. */
function Hero({ item, xtream, onOpen, onPlay }: { item: CatalogItem; xtream?: Xtream; onOpen: () => void; onPlay: () => void }) {
  const [info, setInfo] = useState<TitleInfo | null>(null);
  const art = useArt({ kind: item.kind, name: item.name, year: item.info?.year });
  useEffect(() => {
    setInfo(null);
    if (!xtream || !/^m\d+$/.test(item.key)) return;
    const abort = new AbortController();
    xtream.movieInfo(Number(item.key.slice(1)), abort.signal).then(setInfo, () => undefined);
    return () => abort.abort();
  }, [item, xtream]);
  const backdrop = info?.backdrop ?? art?.backdrop;
  const poster = info?.poster ?? item.logo;
  const rating = info?.rating ?? (Number(item.info?.rating) || undefined);
  return (
    <section className="relative isolate mx-5 flex min-h-[clamp(240px,34vh,360px)] animate-fade-in flex-col justify-end overflow-hidden rounded-xl border-2 border-line shadow-float sm:mx-7">
      <div className="absolute inset-0 -z-10 bg-surface">
        {backdrop ? (
          <img src={imageUrl(backdrop, "w1280")} alt="" className="size-full object-cover" />
        ) : poster ? (
          <img src={imageUrl(poster, "w780")} alt="" className="size-full scale-110 object-cover object-top opacity-70 blur-xl" />
        ) : null}
        <div className="absolute inset-0 bg-linear-to-t from-canvas via-canvas/60 to-transparent" />
        <div className="absolute inset-0 bg-linear-to-r from-canvas/90 via-canvas/40 to-transparent" />
      </div>
      {poster && (
        <img
          src={imageUrl(poster, "w342")}
          alt=""
          className="absolute top-1/2 right-8 hidden aspect-[2/3] w-36 -translate-y-1/2 rotate-2 rounded-md border-2 border-line object-cover shadow-float md:block lg:w-44"
        />
      )}
      <div className="flex max-w-xl flex-col gap-3 p-6 sm:p-8 md:pr-56">
        <span className="type-label text-accent-hi">Novo na lista</span>
        <h2 className="font-display text-[30px] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance sm:text-[38px]">{item.name.replace(/\s*\((19|20)\d{2}\)\s*$/, "")}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-ink/85">
          {(info?.year ?? item.info?.year) && <span>{info?.year ?? item.info?.year}</span>}
          {info?.duration && <span>{info.duration}</span>}
          {rating && (
            <span className="flex items-center gap-1">
              <Star className="size-3.5 fill-warn text-warn" /> {rating.toFixed(1).replace(".", ",")}
            </span>
          )}
          {info?.genres.slice(0, 2).map((g) => (
            <span key={g} className="text-soft">
              {g}
            </span>
          ))}
        </div>
        {info?.plot && <p className="line-clamp-2 text-[15px] leading-relaxed text-ink/80">{info.plot}</p>}
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onPlay}>
            <Play className="size-4 fill-current" /> Assistir
          </Button>
          <Button onClick={onOpen}>
            <Info className="size-4" /> Mais informações
          </Button>
        </div>
      </div>
    </section>
  );
}

/** IPTVnator's dashboard: rails of what's in progress, recent, favourite and new on this list. */
export function Home({
  catalog,
  progress,
  favorites,
  recents,
  loading,
  onOpen,
  onPlayChannel,
  onResume,
  xtream,
  onPlayFilm,
}: {
  catalog: Catalog;
  progress: Record<string, Progress>;
  favorites: Set<string>;
  recents: string[];
  /** Kinds still loading (Xtream films and series are big). */
  loading: Kind[];
  onOpen: (item: CatalogItem) => void;
  onPlayChannel: (item: CatalogItem) => void;
  onResume: (key: string, entry: Progress) => void;
  xtream?: Xtream;
  onPlayFilm: (item: CatalogItem) => void;
}) {
  const index = useIndex(catalog);
  const resume = Object.entries(progress)
    .filter(([, p]) => inProgress(p))
    .sort((a, b) => b[1].at - a[1].at)
    // One per show: its latest episode.
    .filter(([, p], i, all) => !p.owner || p.owner.kind !== "series" || all.findIndex(([, q]) => q.owner?.key === p.owner!.key) === i)
    .slice(0, RAIL_MAX);
  const recentChannels = recents.map((k) => index.get(k)).filter((i): i is CatalogItem => i?.kind === "live").slice(0, RAIL_MAX);
  const favs = [...favorites].map((k) => index.get(k)).filter((i): i is CatalogItem => !!i).slice(0, RAIL_MAX);
  const newest = (kind: Kind) =>
    [...(catalog[kind]?.items ?? [])]
      .filter((i) => i.info?.added)
      .sort((a, b) => (b.info!.added ?? 0) - (a.info!.added ?? 0))
      .slice(0, RAIL_MAX);
  const newMovies = newest("movie");
  const newSeries = newest("series");
  const open = (item: CatalogItem) => (item.kind === "live" ? onPlayChannel(item) : onOpen(item));
  const tile = (item: CatalogItem) =>
    item.kind === "live" ? <ChannelTile key={item.key} item={item} onPlay={() => onPlayChannel(item)} /> : <PosterTile key={item.key} item={item} progress={progress[item.key]} onOpen={() => open(item)} />;
  const nothing = !resume.length && !recentChannels.length && !favs.length && !newMovies.length && !newSeries.length;

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto py-6">
      {newMovies[0] && <Hero item={newMovies[0]} xtream={xtream} onOpen={() => onOpen(newMovies[0]!)} onPlay={() => onPlayFilm(newMovies[0]!)} />}
      {resume.length > 0 && (
        <Rail title="Continuar assistindo" icon={Play}>
          {resume.map(([key, entry]) => (
            <ResumeTile key={key} entry={entry} onResume={() => onResume(key, entry)} />
          ))}
        </Rail>
      )}
      {recentChannels.length > 0 && (
        <Rail title="Canais que você viu" icon={History}>
          {recentChannels.map(tile)}
        </Rail>
      )}
      {favs.length > 0 && (
        <Rail title="Favoritos" icon={Heart}>
          {favs.map(tile)}
        </Rail>
      )}
      {(newMovies.length > 0 || loading.includes("movie")) && (
        <Rail title="Filmes adicionados recentemente" icon={Film} loading={loading.includes("movie")}>
          {newMovies.map(tile)}
        </Rail>
      )}
      {(newSeries.length > 0 || loading.includes("series")) && (
        <Rail title="Séries novas" icon={Clapperboard} loading={loading.includes("series")}>
          {newSeries.map(tile)}
        </Rail>
      )}
      {nothing && !loading.length && (
        <div className="mx-5 grid place-items-center rounded-xl border-2 border-dashed border-line p-10 text-center sm:mx-7">
          <Tv className="size-8 text-accent-hi" />
          <p className="mt-3 font-display text-lg font-extrabold">Comece por um canal</p>
          <p className="mt-1 max-w-sm text-sm text-soft">O que você assistir, favoritar e começar a ver aparece aqui.</p>
        </div>
      )}
    </div>
  );
}

/** Favourites or recents of every kind: channels, films, shows. */
export function Collection({
  title,
  keys,
  catalog,
  progress,
  loading,
  onOpen,
  onPlayChannel,
  empty,
}: {
  title: string;
  keys: string[];
  catalog: Catalog;
  progress: Record<string, Progress>;
  loading: Kind[];
  onOpen: (item: CatalogItem) => void;
  onPlayChannel: (item: CatalogItem) => void;
  empty: string;
}) {
  const index = useIndex(catalog);
  const items = keys.map((k) => index.get(k)).filter((i): i is CatalogItem => !!i);
  const of = (kind: Kind) => items.filter((i) => i.kind === kind);
  const groups = [
    { kind: "live" as const, label: "Canais", icon: Tv },
    { kind: "movie" as const, label: "Filmes", icon: Film },
    { kind: "series" as const, label: "Séries", icon: Clapperboard },
  ].filter((g) => of(g.kind).length);
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto py-6">
      <h1 className="flex items-center gap-3 px-5 font-display text-[28px] font-extrabold tracking-[-0.02em] sm:px-7">
        {title} {loading.length > 0 && <Spinner className="size-5 text-soft" />}
      </h1>
      {groups.map(({ kind, label, icon: Icon }) => (
        <section key={kind} className="flex flex-col gap-3 px-5 sm:px-7">
          <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
            <Icon className="size-5 text-accent-hi" /> {label}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
            {of(kind).map((item) =>
              kind === "live" ? (
                <ChannelTile key={item.key} item={item} onPlay={() => onPlayChannel(item)} width="w-full" />
              ) : (
                <PosterTile key={item.key} item={item} progress={progress[item.key]} onOpen={() => onOpen(item)} width="w-full" />
              ),
            )}
          </div>
        </section>
      ))}
      {!groups.length && !loading.length && <p className="px-5 text-sm text-soft sm:px-7">{empty}</p>}
    </div>
  );
}
