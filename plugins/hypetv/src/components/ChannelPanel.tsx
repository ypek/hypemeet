import { Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { ALL, filterItems } from "../lib/library";
import type { CatalogItem } from "../lib/types";
import { Art } from "./ui";
import { VirtualGrid } from "./VirtualGrid";

/** IPTVnator's fullscreen channel panel: a searchable list beside the picture, to zap without leaving it. */
export function ChannelPanel({ items, playingKey, onPick, onClose }: { items: CatalogItem[]; playingKey?: string; onPick: (item: CatalogItem) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const shown = useMemo(() => filterItems(items, { group: ALL, query: search, favorites: new Set(), recents: [] }), [items, search]);
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b-2 border-line px-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-soft" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Buscar canal"
            aria-label="Buscar canal"
            className="h-10 w-full rounded-full border-2 border-line bg-surface pr-3 pl-9 text-sm font-medium text-ink outline-none placeholder:text-soft focus:border-accent"
          />
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar a lista" className="grid size-9 place-items-center rounded-full text-soft hover:bg-surface-hi hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col py-1 pl-1">
        <VirtualGrid
          items={shown}
          minWidth={0}
          gap={2}
          rowHeight={() => 52}
          resetKey={search}
          keyOf={(i) => i.key}
          render={(item) => {
            const playing = item.key === playingKey;
            return (
              <button
                type="button"
                onClick={() => onPick(item)}
                aria-current={playing || undefined}
                className={`flex size-full items-center gap-2.5 rounded-md px-2 text-left transition ${playing ? "bg-accent/20" : "hover:bg-surface-hi"}`}
              >
                <Art kind="live" name={item.name} src={item.logo} tvgId={item.tvgId} shape="logo" className="size-10 rounded-sm border-2 border-line" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${playing ? "font-bold text-accent-hi" : "font-medium"}`}>{item.name}</span>
                  <span className="block truncate text-[11px] text-soft">{item.group}</span>
                </span>
              </button>
            );
          }}
          empty={<p className="p-4 text-sm text-soft">Nenhum canal com esse nome.</p>}
        />
      </div>
    </>
  );
}
