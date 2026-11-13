import { Clock, Film, Heart, LayoutGrid, Play, Star, Tv } from "lucide-react";
import { useMemo } from "react";
import { ALL, FAVORITES, filterItems, RECENTS } from "../lib/library";
import { inProgress, type Progress } from "../lib/storage";
import { KIND_LABEL, type CatalogItem, type Kind, type Section } from "../lib/types";
import { titleOf } from "./Home";
import { cleanLabel } from "./Rail";
import { Art, Button, Spinner } from "./ui";
import { VirtualGrid } from "./VirtualGrid";

const groupLabel = (group: string) => (group === ALL ? "Todos" : group === FAVORITES ? "Favoritos" : group === RECENTS ? "Recentes" : group);

interface BrowserProps {
  kind: Kind;
  section?: Section;
  status: "loading" | "ready" | "error";
  error?: string;
  onRetry: () => void;
  group: string;
  onGroup: (group: string) => void;
  query: string;
  favorites: Set<string>;
  recents: string[];
  onToggleFavorite: (key: string) => void;
  /** What's playing here, to mark it in the list. */
  playingKey?: string;
  /** Channels: play. */
  onPick: (item: CatalogItem) => void;
  /** Films and series: their page. */
  onOpen: (item: CatalogItem) => void;
  /** Films: how far in, for the bar under the poster. */
  progress?: Record<string, Progress>;
  /** Categories as a select above the list (the sidebar shows them when it's open). */
  select: boolean;
}

export function Browser(props: BrowserProps) {
  const { kind, section, status, error, onRetry, group, onGroup, query, favorites, recents, select } = props;

  // A search looks through every group, except inside favourites and recents.
  const effectiveGroup = query.trim() && group !== FAVORITES && group !== RECENTS ? ALL : group;
  const items = useMemo(
    () => (section ? filterItems(section.items, { group: effectiveGroup, query, favorites, recents }) : []),
    [section, effectiveGroup, query, favorites, recents],
  );
  const favCount = useMemo(() => section?.items.filter((i) => favorites.has(i.key)).length ?? 0, [section, favorites]);

  if (status === "loading" || (!section && status !== "error"))
    return (
      <div className="grid flex-1 place-items-center text-soft">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-7 text-accent-hi" />
          <p className="text-sm">Carregando {KIND_LABEL[kind].toLowerCase()}…</p>
        </div>
      </div>
    );
  if (status === "error" || !section)
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex max-w-xs flex-col items-center gap-3">
          <p className="type-link">{error ?? "Não deu pra carregar"}</p>
          <Button size="sm" onClick={onRetry}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );


  const special = [
    { name: ALL, count: section.items.length, icon: LayoutGrid },
    { name: FAVORITES, count: favCount, icon: Heart },
    { name: RECENTS, count: undefined, icon: Clock },
  ];
  const resetKey = `${kind}\u0000${effectiveGroup}\u0000${query}`;
  const posters = kind !== "live";

  const list = (
    <VirtualGrid
      items={items}
      minWidth={posters ? 128 : 0}
      gap={posters ? 12 : 4}
      rowHeight={(w) => (posters ? Math.round(w * 1.5) + 46 : 56)}
      resetKey={resetKey}
      keyOf={(i) => i.key}
      render={(item) =>
        posters ? (
          <PosterCard item={item} progress={props.progress?.[item.key]} favorite={favorites.has(item.key)} playing={item.key === props.playingKey} onPick={() => props.onOpen(item)} onFavorite={() => props.onToggleFavorite(item.key)} />
        ) : (
          <ChannelRow item={item} favorite={favorites.has(item.key)} playing={item.key === props.playingKey} onPick={() => props.onPick(item)} onFavorite={() => props.onToggleFavorite(item.key)} />
        )
      }
      empty={<Empty group={effectiveGroup} query={query} />}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={`flex min-w-0 flex-1 flex-col gap-3 pt-5 ${posters ? "pl-6 lg:pl-8" : "pl-3.5 lg:pl-5.5"}`}>
        {select && (
          <select
            value={group}
            onChange={(e) => onGroup(e.target.value)}
            aria-label="Categoria"
            className="type-link-sm mr-6 h-10 shrink-0 rounded-full border-2 border-line bg-surface px-4 text-ink outline-none focus:border-accent"
          >
            {special.map(({ name, count }) => (
              <option key={name} value={name}>
                {groupLabel(name)}
                {count !== undefined ? ` (${count})` : ""}
              </option>
            ))}
            {section.groups.map((g) => (
              <option key={g.name} value={g.name}>
                {cleanLabel(g.name)} ({g.count})
              </option>
            ))}
          </select>
        )}
        <div className={`flex items-baseline gap-3 pr-6 ${posters ? "" : "pl-2.5"}`}>
          <h2 className="min-w-0 truncate font-display text-[22px] font-extrabold tracking-[-0.01em]">{query.trim() ? `Busca por “${query.trim()}”` : cleanLabel(groupLabel(effectiveGroup))}</h2>
          <span className="shrink-0 text-sm text-soft tabular-nums">{items.length.toLocaleString("pt-BR")} {kind === "live" ? "canais" : kind === "movie" ? "filmes" : "séries"}</span>
        </div>
        {list}
      </div>
    </div>
  );
}

function FavoriteButton({ favorite, onClick, className = "" }: { favorite: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={favorite ? "Tirar dos favoritos" : "Favoritar"}
      aria-pressed={favorite}
      className={`grid size-8 shrink-0 place-items-center rounded-full transition ${favorite ? "text-accent-hi" : "text-soft opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 hover:text-ink"} ${className}`}
    >
      <Heart className={`size-4 ${favorite ? "fill-current" : ""}`} />
    </button>
  );
}

function ChannelRow({ item, favorite, playing, onPick, onFavorite }: { item: CatalogItem; favorite: boolean; playing: boolean; onPick: () => void; onFavorite: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick())}
      aria-current={playing || undefined}
      className={`group/item relative flex size-full cursor-pointer items-center gap-3 rounded-md px-2.5 transition ${playing ? "bg-surface-hi" : "hover:bg-surface"}`}
    >
      {playing && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent" />}
      <Art kind="live" name={item.name} src={item.logo} tvgId={item.tvgId} shape="logo" className="size-11 rounded-sm border-2 border-line" />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${playing ? "font-semibold text-ink" : "text-ink/95"}`}>{item.name}</p>
        <p className="truncate text-xs text-soft">{playing ? "Tocando agora" : cleanLabel(item.group)}</p>
      </div>
      {playing ? <Play className="mr-2 size-4 shrink-0 fill-current text-accent-hi" /> : null}
      <FavoriteButton favorite={favorite} onClick={onFavorite} />
    </div>
  );
}

function PosterCard({ item, progress, favorite, playing, onPick, onFavorite }: { item: CatalogItem; progress?: Progress; favorite: boolean; playing: boolean; onPick: () => void; onFavorite: () => void }) {
  const meta = [item.info?.year, item.info?.rating && Number(item.info.rating) ? `★ ${Number(item.info.rating).toFixed(1).replace(".", ",")}` : null].filter(Boolean).join(" · ");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick())}
      className="group/item flex size-full cursor-pointer flex-col gap-1.5"
    >
      <div className={`relative min-h-0 flex-1 overflow-hidden rounded-md ring-1 transition ${playing ? "ring-2 ring-accent" : "ring-line group-hover/item:ring-white/20"}`}>
        <Art kind={item.kind} name={item.name} src={item.logo} year={item.info?.year} shape="poster" className="size-full transition duration-300 ease-out-expo group-hover/item:scale-[1.03]" />
        <div className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover/item:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-accent shadow-float">
            {item.series ? <Tv className="size-5" /> : <Play className="size-5 fill-current" />}
          </span>
        </div>
        <FavoriteButton favorite={favorite} onClick={onFavorite} className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-md" />
        {inProgress(progress) && (
          <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60">
            <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (progress!.t / progress!.d) * 100)}%` }} />
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-[13px] leading-tight font-bold">{titleOf(item.name)}</p>
        <p className="truncate text-[11px] text-soft">{meta || cleanLabel(item.group)}</p>
      </div>
    </div>
  );
}

function Empty({ group, query }: { group: string; query: string }) {
  const Icon = group === FAVORITES ? Heart : group === RECENTS ? Clock : query ? Star : Film;
  const text =
    group === FAVORITES ? "Toque no coração de um canal pra guardar aqui." : group === RECENTS ? "O que você assistir aparece aqui." : query ? "Nada com esse nome." : "Essa categoria está vazia.";
  return (
    <div className="grid h-full min-h-40 place-items-center p-6 text-center text-soft">
      <div className="flex flex-col items-center gap-2">
        <Icon className="size-7 text-accent-hi/80" />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}
