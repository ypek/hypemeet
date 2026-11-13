import { Clapperboard, Clock, Film, Heart, History, House, LayoutGrid, Plus, Tv, type LucideIcon } from "lucide-react";
import { ALL, FAVORITES, RECENTS } from "../lib/library";
import type { Kind, Section } from "../lib/types";
import { Wordmark } from "./ui";

export type View = "home" | Kind | "favorites" | "recents";

const ITEMS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "home", label: "Início", icon: House },
  { view: "live", label: "Ao vivo", icon: Tv },
  { view: "movie", label: "Filmes", icon: Film },
  { view: "series", label: "Séries", icon: Clapperboard },
  { view: "favorites", label: "Favoritos", icon: Heart },
  { view: "recents", label: "Recentes", icon: History },
];

export const VIEW_LABEL: Record<View, string> = Object.fromEntries(ITEMS.map((i) => [i.view, i.label])) as Record<View, string>;

/**
 * Panels decorate category names ("♦ Netflix", "CANAIS | UHD 4K ⭐"): shown without the ornaments. The raw name
 * stays the key.
 */
export function cleanLabel(name: string): string {
  return (
    name
      .replace(/[\p{Extended_Pictographic}☀-➿️‍♦◆●•★☆▶►]/gu, " ")
      .replace(/\s*\|\s*/g, " · ")
      .replace(/\s+/g, " ")
      .replace(/^[\s·:–-]+|[\s·:–-]+$/g, "")
      .trim() || name
  );
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

function NavItem({ active, icon: Icon, label, count, onClick, collapsed }: { active: boolean; icon: LucideIcon; label: string; count?: number; onClick: () => void; collapsed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={`group/nav relative flex h-10 shrink-0 items-center gap-3 rounded-md text-left transition ${collapsed ? "w-10 justify-center" : "w-full px-3"} ${active ? "bg-surface-hi text-ink" : "text-soft hover:bg-surface hover:text-ink"}`}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />}
      <Icon className={`size-[18px] shrink-0 ${active ? "text-accent-hi" : ""}`} />
      {!collapsed && <span className="type-link-sm min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && count !== undefined && <span className="shrink-0 text-[11px] font-semibold text-soft/80 tabular-nums">{fmt(count)}</span>}
    </button>
  );
}

/**
 * The whole left side, as one panel: the HypeTv mark, the sections of the open list with their names (IPTVnator's
 * rail, labelled), and under the section on screen its categories. Collapses to icons on mid-size screens and
 * becomes a bottom bar on phones.
 */
export function Sidebar({
  view,
  onView,
  kinds,
  counts,
  section,
  group,
  onGroup,
  favoriteCount,
  onAdd,
  mode,
}: {
  view: View;
  onView: (v: View) => void;
  kinds: Kind[];
  counts: Partial<Record<Kind, number>>;
  /** The categories of the section on screen (live, films or series). */
  section?: Section;
  group: string;
  onGroup: (group: string) => void;
  favoriteCount: number;
  onAdd: () => void;
  mode: "full" | "icons" | "bar";
}) {
  const items = ITEMS.filter((i) => !(i.view === "live" || i.view === "movie" || i.view === "series") || kinds.includes(i.view));

  if (mode === "bar")
    return (
      <nav aria-label="Seções" className="order-last flex h-16 shrink-0 items-stretch justify-around border-t-2 border-line bg-panel px-1">
        {items.map(({ view: v, label, icon: Icon }) => (
          <button key={v} type="button" onClick={() => onView(v)} aria-current={view === v ? "page" : undefined} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-bold ${view === v ? "text-accent-hi" : "text-soft"}`}>
            <Icon className="size-5" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>
    );

  const collapsed = mode === "icons";
  const categories = section && (view === "live" || view === "movie" || view === "series");
  return (
    <aside className={`flex shrink-0 flex-col border-r-2 border-line bg-panel ${collapsed ? "w-[4.25rem] items-center" : "w-64"}`}>
      <div className={`flex h-14 shrink-0 items-center border-b-2 border-line ${collapsed ? "justify-center" : "px-4"}`}>
        {collapsed ? <img src="./icon.svg" alt="HypeTv" className="size-9" /> : <Wordmark className="text-[22px]" />}
      </div>
      <nav aria-label="Seções" className={`flex shrink-0 flex-col gap-0.5 p-2.5 ${collapsed ? "items-center" : ""}`}>
        {items.map(({ view: v, label, icon }) => (
          <NavItem
            key={v}
            active={view === v}
            icon={icon}
            label={label}
            collapsed={collapsed}
            count={v === "favorites" ? favoriteCount || undefined : v === "live" || v === "movie" || v === "series" ? counts[v] : undefined}
            onClick={() => onView(v)}
          />
        ))}
      </nav>

      {categories && !collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col border-t-2 border-line">
          <div className="type-label flex items-center justify-between px-5 pt-4 pb-2 text-soft/80">
            <span>Categorias</span>
            <span className="tabular-nums">{fmt(section.groups.length)}</span>
          </div>
          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
            {[
              { name: ALL, label: "Todos", icon: LayoutGrid, count: section.items.length },
              { name: FAVORITES, label: "Favoritos", icon: Heart, count: undefined },
              { name: RECENTS, label: "Recentes", icon: Clock, count: undefined },
            ].map(({ name, label, icon: Icon, count }) => (
              <button
                key={name}
                type="button"
                onClick={() => onGroup(name)}
                className={`flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition ${group === name ? "bg-surface-hi font-bold text-ink" : "text-soft hover:bg-surface hover:text-ink"}`}
              >
                <Icon className={`size-4 shrink-0 ${group === name ? "text-accent-hi" : ""}`} />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count !== undefined && <span className="shrink-0 text-[11px] text-soft/80 tabular-nums">{fmt(count)}</span>}
              </button>
            ))}
            <div className="my-1.5 h-0.5 shrink-0 rounded-full bg-line/60" />
            {section.groups.map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => onGroup(g.name)}
                title={g.name}
                className={`flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition ${group === g.name ? "bg-surface-hi font-bold text-ink" : "text-soft hover:bg-surface hover:text-ink"}`}
              >
                <span className={`size-1.5 shrink-0 rounded-full ${group === g.name ? "bg-accent" : "bg-line"}`} />
                <span className="min-w-0 flex-1 truncate">{cleanLabel(g.name)}</span>
                <span className="shrink-0 text-[11px] text-soft/80 tabular-nums">{fmt(g.count)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <span className="flex-1" />
      )}

      <div className={`shrink-0 border-t-2 border-line p-2.5 ${collapsed ? "flex justify-center" : ""}`}>
        <NavItem active={false} icon={Plus} label="Adicionar lista" collapsed={collapsed} onClick={onAdd} />
      </div>
    </aside>
  );
}
