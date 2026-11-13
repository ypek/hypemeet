import { Check, ChevronDown, ListVideo, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PlaylistConfig } from "../lib/storage";
import type { XtreamAccount } from "../lib/xtream";

const kindLabel = (c: PlaylistConfig) => (c.type === "xtream" ? "Xtream Codes" : c.type === "m3u-file" ? "Arquivo M3U" : "Link M3U");

function accountLine(account?: XtreamAccount) {
  if (!account) return null;
  const parts = [];
  if (account.expires) parts.push(`vence ${new Date(account.expires).toLocaleDateString("pt-BR")}`);
  if (account.maxConnections) parts.push(account.maxConnections === 1 ? "1 conexão" : `${account.maxConnections} conexões`);
  return parts.join(" · ");
}

/** The list switcher at the top left: other lists, refresh, add, remove. */
export function PlaylistMenu({
  playlists,
  active,
  account,
  onSelect,
  onAdd,
  onRefresh,
  onRemove,
  compact,
}: {
  playlists: PlaylistConfig[];
  active: PlaylistConfig;
  account?: XtreamAccount;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return setConfirm(false);
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item = "flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-sm transition hover:bg-surface-hi";
  const info = accountLine(account);
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-10 min-w-0 items-center gap-2.5 rounded-md border-2 border-line bg-surface pr-2.5 pl-1.5 transition hover:bg-surface-hi"
      >
        <img src="./icon.svg" alt="" className="size-7 shrink-0" />
        {!compact && <span className="type-link-sm max-w-40 truncate">{active.name}</span>}
        <ChevronDown className={`size-4 shrink-0 text-soft transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-40 mt-2 flex w-72 animate-pop flex-col gap-1 rounded-lg bg-panel p-2 shadow-float border-2 border-line">
          <div className="px-3 pt-1.5 pb-2">
            <p className="type-link-sm truncate">{active.name}</p>
            <p className="truncate text-xs text-soft">{[kindLabel(active), info].filter(Boolean).join(" · ")}</p>
          </div>
          {playlists.length > 1 && (
            <>
              <div className="type-label px-3 pt-1 pb-1 text-soft/80">Listas</div>
              {playlists.map((p) => (
                <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === active.id} onClick={() => (onSelect(p.id), setOpen(false))} className={item}>
                  <ListVideo className="size-4 shrink-0 text-soft" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === active.id && <Check className="size-4 shrink-0 text-accent-hi" />}
                </button>
              ))}
              <div className="my-1 h-px bg-line" />
            </>
          )}
          {active.type !== "m3u-file" && (
            <button type="button" role="menuitem" onClick={() => (onRefresh(), setOpen(false))} className={item}>
              <RefreshCw className="size-4 shrink-0 text-soft" /> Atualizar lista
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => (onAdd(), setOpen(false))} className={item}>
            <Plus className="size-4 shrink-0 text-soft" /> Adicionar outra lista
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => (confirm ? (onRemove(active.id), setOpen(false)) : setConfirm(true))}
            className={`${item} ${confirm ? "bg-danger/15 text-ink hover:bg-danger/25" : "text-danger"}`}
          >
            <Trash2 className="size-4 shrink-0" /> {confirm ? "Toque de novo pra remover" : "Remover esta lista"}
          </button>
        </div>
      )}
    </div>
  );
}
