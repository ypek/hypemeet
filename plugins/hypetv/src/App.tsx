import { Search, Tv, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AddPlaylist } from "./components/AddPlaylist";
import { Browser } from "./components/Browser";
import { ChannelPanel } from "./components/ChannelPanel";
import { Detail, type PlayRequest } from "./components/Detail";
import { Collection, Home } from "./components/Home";
import { NowPlaying, RoomBanner, useGuide } from "./components/NowPlaying";
import { createHandle, Player } from "./components/Player";
import { PlaylistMenu } from "./components/PlaylistMenu";
import { Sidebar, VIEW_LABEL, type View } from "./components/Rail";
import { SearchResults } from "./components/Search";
import { Button, Spinner } from "./components/ui";
import { useSize } from "./components/VirtualGrid";
import { ALL, filterItems } from "./lib/library";
import {
  forgetPlaylist,
  loadFavorites,
  loadLast,
  loadPlaylists,
  loadProgress,
  loadRecents,
  pushRecent,
  saveFavorites,
  saveLast,
  savePlaylists,
  saveProgress,
  type PlaylistConfig,
  type Progress,
} from "./lib/storage";
import type { CatalogItem, Kind, Playable } from "./lib/types";
import { useHost, useTogether } from "./room";
import { useCatalog } from "./useCatalog";

interface Now {
  play: Playable;
  /** The channel, film or episode playing, when it came from our own list (favourites, progress). */
  key?: string;
  /** Films: resume from here. */
  start?: number;
  /** What goes in "recents" once it actually plays: the channel, the film, or an episode's show. */
  recentKey?: string;
  owner?: Progress["owner"];
}

const KINDS: Kind[] = ["live", "movie", "series"];
const isKind = (v: View): v is Kind => v === "live" || v === "movie" || v === "series";

export function App() {
  const host = useHost();
  const [playlists, setPlaylists] = useState(loadPlaylists);
  const [activeId, setActiveId] = useState<string | null>(() => {
    const last = loadLast().playlist;
    return playlists.find((p) => p.id === last)?.id ?? playlists[0]?.id ?? null;
  });
  const [adding, setAdding] = useState(false);
  const active = playlists.find((p) => p.id === activeId) ?? playlists[0] ?? null;

  // Dev: the lists in .env.local (HYPETV_DEV_XTREAM) are added on first load, so testing starts on a real list.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    fetch(new URL("api/dev-playlists", document.baseURI))
      .then((r) => (r.ok ? r.json() : []))
      .then((lists: { name: string; server: string; username: string; password: string }[]) => {
        if (cancelled || !Array.isArray(lists) || !lists.length) return;
        setPlaylists((current) => {
          const fresh = lists
            .filter((l) => !current.some((c) => c.type === "xtream" && c.server === l.server && c.username === l.username))
            .map((l, i): PlaylistConfig => ({ id: `dev-${i}-${l.username}`, addedAt: Date.now(), type: "xtream", ...l }));
          if (!fresh.length) return current;
          const next = [...fresh, ...current];
          savePlaylists(next);
          setActiveId(fresh[0]!.id);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const catalog = useCatalog(active);

  const [wanted, setView] = useState<View>(() => (loadLast().view as View) || "home");
  const view: View = isKind(wanted) && catalog.status === "ready" && !catalog.kinds.includes(wanted) ? "home" : wanted;
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [groups, setGroups] = useState<Record<Kind, string>>({ live: ALL, movie: ALL, series: ALL });
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  /** The header searches everything; "Ver todos" narrows it to one kind, shown in that kind's own page. */
  const [scope, setScope] = useState<"all" | Kind>("all");
  const searching = search.trim().length >= 2;
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  const activeKey = active?.id;
  useEffect(() => {
    if (!activeKey) return;
    setFavorites(loadFavorites(activeKey));
    setRecents(loadRecents(activeKey));
    setProgress(loadProgress(activeKey));
    setGroups({ live: ALL, movie: ALL, series: ALL });
    setQuery("");
    setDetail(null);
  }, [activeKey]);
  useEffect(() => saveLast({ playlist: activeKey, view }), [activeKey, view]);

  const go = (v: View) => {
    setView(v);
    setDetail(null);
    setQuery("");
    setScope("all");
  };

  // Xtream sections load when a page needs them: its own kind, or all three for home, favourites and recents.
  const { status, xtream, sections, loadSection } = catalog;
  const needed = useMemo(() => (isKind(view) && !(searching && scope === "all") ? [view] : KINDS), [view, searching, scope]);
  useEffect(() => {
    if (status !== "ready" || !xtream) return;
    for (const k of needed) if (!sections[k]) loadSection(k);
  }, [status, xtream, sections, needed, loadSection]);
  const loadingKinds = catalog.kinds.filter((k) => needed.includes(k) && catalog.sections[k]?.status !== "ready");

  const [handle] = useState(createHandle);
  const [now, setNow] = useState<Now | null>(null);
  const together = useTogether(host, handle, useCallback((item: Playable) => setNow({ play: item }), []));
  const guide = useGuide(now?.key ? catalog.xtream : undefined, now?.play ?? null);

  const playChannel = (item: CatalogItem) => {
    if (!item.play) return;
    setNow({ play: item.play, key: item.key, recentKey: item.key });
    together.pickedLocally(item.play);
  };
  const play = (req: PlayRequest) => {
    setNow({ play: req.play, key: req.key, start: req.start, recentKey: req.owner.key, owner: req.owner });
    together.pickedLocally(req.play);
  };
  const resume = (key: string, entry: Progress) => {
    setNow({ play: entry.play, key, start: entry.t, recentKey: entry.owner?.key ?? key, owner: entry.owner });
    together.pickedLocally(entry.play);
  };
  const toggleFavorite = (key: string) => {
    if (!active) return;
    setFavorites((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      saveFavorites(active.id, next);
      return next;
    });
  };
  const closePlayer = () => {
    if (together.hosting) together.stopPassing();
    together.unfollow();
    setNow(null);
  };

  // The channels PageUp / PageDown and the player's panel go through: the live group on screen, or all of them.
  const liveItems = catalog.catalog.live?.items;
  const zapList = useMemo(() => {
    if (!liveItems) return [];
    const shown = filterItems(liveItems, { group: groups.live, query: view === "live" ? search : "", favorites, recents });
    return now?.key && shown.some((i) => i.key === now.key) ? shown : liveItems;
  }, [liveItems, groups.live, view, search, favorites, recents, now?.key]);
  const zap = (delta: -1 | 1) => {
    if (!now?.play.live || !zapList.length) return;
    const at = zapList.findIndex((i) => i.key === now.key);
    playChannel(zapList[(at + delta + zapList.length) % zapList.length]!);
  };

  const added = (config: PlaylistConfig) => {
    const next = [...playlists, config];
    setPlaylists(next);
    savePlaylists(next);
    setActiveId(config.id);
    setAdding(false);
  };
  const remove = (id: string) => {
    const next = playlists.filter((p) => p.id !== id);
    forgetPlaylist(id);
    setPlaylists(next);
    savePlaylists(next);
    setActiveId(next[0]?.id ?? null);
  };

  const [root, { width }] = useSize<HTMLDivElement>();
  const layout = width >= 1080 ? "wide" : width >= 700 ? "medium" : "narrow";
  const inRoom = host.status === "room";
  const invite = together.broadcast && !together.hosting && !together.following ? together.broadcast : null;
  const showPlayer = !!now || (layout !== "narrow" && view === "live" && !detail);
  const favoriteKey = now?.key && (catalog.catalog.live?.items.some((i) => i.key === now.key) || now.owner) ? (now.owner?.key ?? now.key) : undefined;
  const warning = catalog.account?.maxConnections === 1 && now && !now.play.live ? "Sua lista aceita 1 conexão: num filme, os outros podem não conseguir abrir." : undefined;

  const sidebarMode = layout === "narrow" ? "bar" : layout === "medium" && showPlayer ? "icons" : "full";

  if (!active) return <AddPlaylist onAdded={added} />;

  const contentWidth =
    !showPlayer || layout === "narrow"
      ? "flex-1"
      : view === "live" && !detail
        ? layout === "wide"
          ? "w-[36rem]"
          : "w-80"
        : layout === "wide"
          ? "w-[min(46rem,52%)]"
          : "w-[24rem]";

  let content;
  if (catalog.status === "loading")
    content = (
      <div className="grid flex-1 place-items-center text-soft">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-8 text-accent-hi" />
          <p className="text-sm">Abrindo {active.name}…</p>
        </div>
      </div>
    );
  else if (catalog.status === "error")
    content = (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex max-w-sm animate-pop flex-col items-center gap-3">
          <p className="type-link">{catalog.error}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={catalog.refresh}>
              Tentar de novo
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              Adicionar outra lista
            </Button>
          </div>
        </div>
      </div>
    );
  else if (searching && scope === "all" && !detail)
    content = (
      <SearchResults
        query={search.trim()}
        catalog={catalog.catalog}
        progress={progress}
        loading={loadingKinds}
        onOpen={setDetail}
        onPlayChannel={playChannel}
        onSeeAll={(kind) => {
          setView(kind);
          setScope(kind);
          setGroups((g) => ({ ...g, [kind]: ALL }));
        }}
      />
    );
  else if (detail)
    content = (
      <Detail
        item={detail}
        xtream={catalog.xtream}
        progress={progress}
        favorite={favorites.has(detail.key)}
        onToggleFavorite={() => toggleFavorite(detail.key)}
        onPlay={play}
        onBack={() => setDetail(null)}
        playingKey={now?.key}
        compact={showPlayer}
      />
    );
  else if (view === "home")
    content = (
      <Home
        catalog={catalog.catalog}
        progress={progress}
        favorites={favorites}
        recents={recents}
        loading={loadingKinds}
        onOpen={setDetail}
        onPlayChannel={playChannel}
        onResume={resume}
        xtream={catalog.xtream}
        onPlayFilm={(item) => item.play && play({ play: item.play, key: item.key, start: progress[item.key]?.t, owner: { key: item.key, name: item.name, poster: item.logo, kind: "movie" } })}
      />
    );
  else if (view === "favorites" || view === "recents")
    content = (
      <Collection
        title={VIEW_LABEL[view]}
        keys={view === "favorites" ? [...favorites] : recents}
        catalog={catalog.catalog}
        progress={progress}
        loading={loadingKinds}
        onOpen={setDetail}
        onPlayChannel={playChannel}
        empty={view === "favorites" ? "Toque no coração de um canal, filme ou série pra guardar aqui." : "O que você assistir aparece aqui."}
      />
    );
  else
    content = (
      <Browser
        kind={view}
        section={catalog.catalog[view]}
        status={catalog.sections[view]?.status ?? "loading"}
        error={catalog.sections[view]?.error}
        onRetry={catalog.refresh}
        group={groups[view]}
        onGroup={(g) => setGroups((s) => ({ ...s, [view]: g }))}
        query={searching && scope === view ? search : ""}
        favorites={favorites}
        recents={recents}
        onToggleFavorite={toggleFavorite}
        playingKey={now?.owner?.key ?? now?.key}
        onPick={playChannel}
        onOpen={setDetail}
        progress={progress}
        select={sidebarMode !== "full"}
      />
    );

  const idle = (
    <div className="grid size-full place-items-center bg-canvas p-6 text-center">
      <div className="flex flex-col items-center gap-3 text-soft">
        <div className="grid size-14 place-items-center rounded-lg border-2 border-line bg-surface">
          <Tv className="size-6 text-accent-hi" />
        </div>
        <p className="font-display text-lg font-extrabold text-ink">Escolha um canal</p>
        <p className="max-w-64 text-sm">{inRoom ? "Depois é só passar pra sala: quem estiver com o HypeTv aberto assiste junto." : "Abra pela sala do HypeMeet pra assistir junto com a galera."}</p>
      </div>
    </div>
  );

  const title = detail ? (detail.kind === "series" ? "Série" : "Filme") : searching && scope === "all" ? "Busca" : VIEW_LABEL[view];

  return (
    <div ref={root} className={`relative flex size-full bg-canvas ${layout === "narrow" ? "flex-col" : "flex-row"}`}>
      <Sidebar
        view={view}
        onView={go}
        kinds={catalog.kinds.length ? catalog.kinds : KINDS}
        counts={{ live: catalog.catalog.live?.items.length, movie: catalog.catalog.movie?.items.length, series: catalog.catalog.series?.items.length }}
        section={isKind(view) ? catalog.catalog[view] : undefined}
        group={isKind(view) ? groups[view] : ALL}
        onGroup={(g) => {
          if (!isKind(view)) return;
          setGroups((s) => ({ ...s, [view]: g }));
          setDetail(null);
          setQuery("");
          setScope("all");
        }}
        favoriteCount={favorites.size}
        onAdd={() => setAdding(true)}
        mode={sidebarMode}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-line bg-panel px-4">
          <h1 className={`min-w-0 shrink-0 truncate font-display text-lg font-extrabold tracking-[-0.01em] ${layout === "narrow" ? "hidden" : "w-40"}`}>{title}</h1>
          <div className="relative mx-auto w-full min-w-0 max-w-xl flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-soft" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setScope("all");
                setDetail(null);
              }}
              onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setScope("all"))}
              placeholder="Buscar canais, filmes e séries"
              aria-label="Buscar canais, filmes e séries"
              className="h-10 w-full rounded-full border-2 border-line bg-surface pr-10 pl-11 text-sm font-medium text-ink outline-none placeholder:text-soft focus:border-accent"
            />
            {query && (
              <button type="button" onClick={() => (setQuery(""), setScope("all"))} aria-label="Limpar busca" className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-soft hover:text-ink">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className={`flex shrink-0 justify-end ${layout === "narrow" ? "" : "w-40"}`}>
            <PlaylistMenu
              playlists={playlists}
              active={active}
              account={catalog.account}
              compact={layout === "narrow"}
              onSelect={setActiveId}
              onAdd={() => setAdding(true)}
              onRefresh={catalog.refresh}
              onRemove={remove}
            />
          </div>
        </header>

        <main className={`flex min-h-0 flex-1 ${layout === "narrow" ? "flex-col" : "flex-row"}`}>
          <section className={`flex min-h-0 min-w-0 flex-col ${contentWidth} ${layout === "narrow" ? "order-2" : showPlayer ? "border-r-2 border-line" : ""}`}>
            {invite && !showPlayer && (
              <div className="shrink-0 p-2.5 pb-0">
                <RoomBanner broadcast={invite} onFollow={together.follow} compact />
              </div>
            )}
            {content}
          </section>

          {showPlayer && (
            <section className={`flex min-h-0 min-w-0 flex-col ${layout === "narrow" ? "order-1 shrink-0" : "flex-1"}`}>
              <div className={`relative min-h-0 ${layout === "narrow" ? "aspect-video max-h-[42vh] w-full" : "flex-1"}`}>
                <Player
                  play={now?.play ?? null}
                  handle={handle}
                  idle={idle}
                  className="size-full"
                  start={now?.start}
                  onStarted={() => now?.recentKey && setRecents(pushRecent(active.id, now.recentKey))}
                  onProgress={(t, d) => now?.key && setProgress(saveProgress(active.id, now.key, t, d, now.play, now.owner))}
                  onZap={now?.play.live ? zap : undefined}
                  panel={
                    now?.play.live && zapList.length
                      ? (close) => (
                          <ChannelPanel
                            items={zapList}
                            playingKey={now.key}
                            onClose={close}
                            onPick={(item) => {
                              playChannel(item);
                            }}
                          />
                        )
                      : undefined
                  }
                  actions={
                    now && (
                      <button type="button" onClick={closePlayer} aria-label="Fechar o player" title="Fechar o player" className="grid size-9 shrink-0 place-items-center rounded-full text-ink transition hover:bg-white/15">
                        <X className="size-4" />
                      </button>
                    )
                  }
                />
                {invite && (
                  <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center [&>*]:pointer-events-auto">
                    <RoomBanner broadcast={invite} onFollow={together.follow} />
                  </div>
                )}
              </div>
              {now && (
                <NowPlaying
                  play={now.play}
                  guide={guide}
                  favorite={favoriteKey ? favorites.has(favoriteKey) : undefined}
                  onFavorite={favoriteKey ? () => toggleFavorite(favoriteKey) : undefined}
                  together={together}
                  inRoom={inRoom}
                  warning={warning}
                />
              )}
            </section>
          )}
        </main>
      </div>

      {adding && (
        <div className="absolute inset-0 z-50 bg-scrim backdrop-blur-sm">
          <AddPlaylist onAdded={added} onCancel={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}
