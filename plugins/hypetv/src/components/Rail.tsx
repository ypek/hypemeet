import { Clapperboard, Film, Heart, History, House, Plus, Tv, type LucideIcon } from "lucide-react";
import type { Kind } from "../lib/types";

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
 * IPTVnator's icon rail, in the room's own rail style: the sections of the open list, with "add a list" at the
 * bottom. Kinds the list doesn't have are left out.
 */
export function Rail({ view, onView, kinds, onAdd, horizontal }: { view: View; onView: (v: View) => void; kinds: Kind[]; onAdd: () => void; horizontal?: boolean }) {
  const items = ITEMS.filter((i) => !(i.view === "live" || i.view === "movie" || i.view === "series") || kinds.includes(i.view));
  const button = (active: boolean) =>
    `grid size-11 shrink-0 place-items-center rounded-md border-2 transition duration-200 ease-out-expo ${active ? "border-accent-hi bg-accent text-on-accent shadow-sticker" : "border-transparent text-soft hover:bg-surface-hi hover:text-ink"}`;
  return (
    <nav
      aria-label="Seções"
      className={`flex shrink-0 items-center gap-1.5 bg-panel ${horizontal ? "order-last h-15 justify-around border-t-2 border-line px-2" : "w-17 flex-col border-r-2 border-line py-2.5"}`}
    >
      {!horizontal && <img src="./icon.svg" alt="HypeTv" className="mb-2 size-11 shrink-0" />}
      {items.map(({ view: v, label, icon: Icon }) => (
        <button key={v} type="button" onClick={() => onView(v)} aria-current={view === v ? "page" : undefined} aria-label={label} title={label} className={button(view === v)}>
          <Icon className="size-5" />
        </button>
      ))}
      {!horizontal && <span className="flex-1" />}
      <button type="button" onClick={onAdd} aria-label="Adicionar lista" title="Adicionar lista" className={button(false)}>
        <Plus className="size-5" />
      </button>
    </nav>
  );
}
