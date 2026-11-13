import { Heart, Radio, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Broadcast, Together } from "../room";
import type { Playable } from "../lib/types";
import type { GuideEntry, Xtream } from "../lib/xtream";
import { Art, Button, Face, LiveBadge } from "./ui";

const clock = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Now / next for an Xtream channel, refreshed every minute. */
export function useGuide(xtream: Xtream | undefined, play: Playable | null): GuideEntry[] {
  const [guide, setGuide] = useState<GuideEntry[]>([]);
  const id = play?.live ? play.epgId : undefined;
  useEffect(() => {
    setGuide([]);
    if (!xtream || id === undefined) return;
    const abort = new AbortController();
    const load = () => xtream.guide(id, abort.signal).then(setGuide, () => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [xtream, id]);
  return guide;
}

function GuideLine({ guide }: { guide: GuideEntry[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const current = guide.find((g) => g.start <= now && g.end > now);
  const next = guide.find((g) => g.start >= (current?.end ?? now));
  if (!current && !next) return null;
  const progress = current ? Math.min(100, ((now - current.start) / (current.end - current.start)) * 100) : 0;
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1 text-xs">
      {current && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-soft tabular-nums">{clock(current.start)}</span>
          <span className="min-w-0 truncate font-semibold text-ink/90" title={current.description}>
            {current.title}
          </span>
          <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full rounded-full bg-accent-hi" style={{ width: `${progress}%` }} />
          </span>
        </div>
      )}
      {next && (
        <div className="flex min-w-0 items-center gap-2 text-soft">
          <span className="shrink-0 tabular-nums">{clock(next.start)}</span>
          <span className="min-w-0 truncate">A seguir: {next.title}</span>
        </div>
      )}
    </div>
  );
}

/** The bar under the player: what's on, the guide, and passing it to the room. */
export function NowPlaying({
  play,
  guide,
  favorite,
  onFavorite,
  together,
  inRoom,
  warning,
}: {
  play: Playable;
  guide: GuideEntry[];
  favorite?: boolean;
  onFavorite?: () => void;
  together: Together;
  inRoom: boolean;
  /** Shown to the host when the room might not manage to watch along (one-connection lists). */
  warning?: string;
}) {
  const { hosting, following, broadcast, audience } = together;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t-2 border-line bg-panel px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Art kind={play.live ? "live" : "movie"} name={play.title} src={play.logo} shape={play.live ? "logo" : "poster"} className={`rounded-sm border-2 border-line ${play.live ? "size-12" : "h-14 w-10"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="type-link-sm min-w-0 truncate">{play.title}</p>
            {play.live && <LiveBadge />}
            {onFavorite && (
              <button type="button" onClick={onFavorite} aria-label={favorite ? "Tirar dos favoritos" : "Favoritar"} aria-pressed={favorite} className={`shrink-0 ${favorite ? "text-accent-hi" : "text-soft hover:text-ink"}`}>
                <Heart className={`size-4 ${favorite ? "fill-current" : ""}`} />
              </button>
            )}
          </div>
          {play.subtitle && <p className="truncate text-xs text-soft">{play.subtitle}</p>}
          <GuideLine guide={guide} />
        </div>
      </div>

      {inRoom && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hosting && (
            <>
              <span className="flex items-center gap-2 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-hi">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent-hi/70" />
                  <span className="relative size-2 rounded-full bg-accent-hi" />
                </span>
                Passando pra sala
                {audience.length > 0 && (
                  <span className="flex -space-x-1.5">
                    {audience.slice(0, 4).map((p) => (
                      <Face key={p.identity} name={p.name} image={p.avatar} className="size-5 text-[8px] ring-2 ring-panel" />
                    ))}
                  </span>
                )}
              </span>
              <Button size="sm" onClick={together.stopPassing}>
                <X className="size-4" /> Parar
              </Button>
            </>
          )}
          {following && broadcast && (
            <>
              <span className="flex items-center gap-2 text-xs text-soft">
                <Face name={broadcast.name} image={broadcast.avatar} className="size-5 text-[8px]" />
                Assistindo junto com <span className="font-semibold text-ink">{broadcast.name}</span>
              </span>
              <Button size="sm" variant="quiet" onClick={together.unfollow}>
                Sair
              </Button>
            </>
          )}
          {!hosting && !following && (
            <Button size="sm" variant="primary" onClick={() => together.pass(play)} title="Quem está com o plugin aberto vê e pode assistir junto">
              <Radio className="size-4" /> Passar pra sala
            </Button>
          )}
        </div>
      )}
      {hosting && warning && <p className="text-xs text-warn sm:hidden">{warning}</p>}
      {hosting && warning && (
        <p className="hidden max-w-56 text-[11px] leading-snug text-warn sm:block" title={warning}>
          {warning}
        </p>
      )}
    </div>
  );
}

/** Someone else is passing something and we aren't watching it. */
export function RoomBanner({ broadcast, onFollow, compact }: { broadcast: Broadcast; onFollow: () => void; compact?: boolean }) {
  return (
    <div className={`flex animate-fade-in items-center gap-3 rounded-lg border border-accent/30 bg-panel/95 p-2.5 pl-3 shadow-float backdrop-blur-xl ${compact ? "" : "max-w-md"}`}>
      <Face name={broadcast.name} image={broadcast.avatar} className="size-9 text-xs" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate text-xs text-soft">
          <span className="font-semibold text-ink">{broadcast.name}</span> está passando
        </p>
        <p className="type-link-sm truncate">{broadcast.item.title}</p>
      </div>
      <Button size="sm" variant="primary" onClick={onFollow}>
        <Users className="size-4" /> Assistir junto
      </Button>
    </div>
  );
}
