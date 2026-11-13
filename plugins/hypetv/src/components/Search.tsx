import { ArrowRight, Clapperboard, Film, SearchX, Tv } from "lucide-react";
import { useMemo } from "react";
import { ALL, filterItems } from "../lib/library";
import type { Progress } from "../lib/storage";
import type { Catalog, CatalogItem, Kind } from "../lib/types";
import { ChannelTile, PosterTile } from "./Home";
import { Spinner } from "./ui";

const LIMIT: Record<Kind, number> = { live: 12, movie: 18, series: 18 };
const SECTIONS = [
  { kind: "live" as const, label: "Canais", icon: Tv },
  { kind: "movie" as const, label: "Filmes", icon: Film },
  { kind: "series" as const, label: "Séries", icon: Clapperboard },
];
const none = { favorites: new Set<string>(), recents: [] as string[] };

/** The header's search, across channels, films and series at once. */
export function SearchResults({
  query,
  catalog,
  progress,
  loading,
  onOpen,
  onPlayChannel,
  onSeeAll,
}: {
  query: string;
  catalog: Catalog;
  progress: Record<string, Progress>;
  loading: Kind[];
  onOpen: (item: CatalogItem) => void;
  onPlayChannel: (item: CatalogItem) => void;
  onSeeAll: (kind: Kind) => void;
}) {
  const results = useMemo(
    () => Object.fromEntries(SECTIONS.map(({ kind }) => [kind, catalog[kind] ? filterItems(catalog[kind]!.items, { ...none, group: ALL, query }) : []])) as Record<Kind, CatalogItem[]>,
    [catalog, query],
  );
  const total = SECTIONS.reduce((n, { kind }) => n + results[kind].length, 0);

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-6 py-6 lg:px-8">
      <div className="flex shrink-0 items-baseline gap-3">
        <h1 className="min-w-0 truncate font-display text-[28px] font-extrabold tracking-[-0.02em]">“{query}”</h1>
        <span className="shrink-0 text-sm text-soft">{total.toLocaleString("pt-BR")} resultados</span>
        {loading.length > 0 && <Spinner className="size-4 shrink-0 text-soft" />}
      </div>
      {SECTIONS.filter(({ kind }) => results[kind].length).map(({ kind, label, icon: Icon }) => {
        const all = results[kind];
        return (
          <section key={kind} className="flex shrink-0 flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
                <Icon className="size-5 text-accent-hi" /> {label}
              </h2>
              <span className="text-sm text-soft tabular-nums">{all.length.toLocaleString("pt-BR")}</span>
              {all.length > LIMIT[kind] && (
                <button type="button" onClick={() => onSeeAll(kind)} className="type-link-sm ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-accent-hi transition hover:bg-surface-hi">
                  Ver todos <ArrowRight className="size-4" />
                </button>
              )}
            </div>
            <div className={`grid gap-3 ${kind === "live" ? "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]"}`}>
              {all.slice(0, LIMIT[kind]).map((item) =>
                kind === "live" ? (
                  <ChannelTile key={item.key} item={item} onPlay={() => onPlayChannel(item)} width="w-full" />
                ) : (
                  <PosterTile key={item.key} item={item} progress={progress[item.key]} onOpen={() => onOpen(item)} width="w-full" />
                ),
              )}
            </div>
          </section>
        );
      })}
      {!total && !loading.length && (
        <div className="grid shrink-0 place-items-center gap-2 py-16 text-center text-soft">
          <SearchX className="size-8 text-accent-hi" />
          <p className="font-display text-lg font-extrabold text-ink">Nada com esse nome</p>
          <p className="text-sm">Tente outra palavra, ou só uma parte do nome.</p>
        </div>
      )}
    </div>
  );
}
