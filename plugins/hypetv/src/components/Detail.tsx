import { ArrowLeft, Check, Heart, Play, RotateCcw, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useArt } from "../lib/art";
import { seasonsOf } from "../lib/library";
import { imageUrl, ListError } from "../lib/net";
import { inProgress, watched, type Progress } from "../lib/storage";
import type { CatalogItem, Episode, Playable } from "../lib/types";
import type { TitleInfo, Xtream } from "../lib/xtream";
import { cleanLabel } from "./Rail";
import { Art, Button, Spinner } from "./ui";

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

const chip = "inline-flex h-7 items-center gap-1 rounded-full border-2 border-line bg-surface px-2.5 text-xs font-bold text-ink/90";

export interface PlayRequest {
  play: Playable;
  key: string;
  start?: number;
  owner: { key: string; name: string; poster?: string; kind: "movie" | "series" };
}

/** A film's or a show's page (IPTVnator's VOD / serial details): backdrop, poster, facts, play or resume, episodes. */
export function Detail({
  item,
  xtream,
  progress,
  favorite,
  onToggleFavorite,
  onPlay,
  onBack,
  playingKey,
  compact,
}: {
  item: CatalogItem;
  xtream?: Xtream;
  progress: Record<string, Progress>;
  favorite: boolean;
  onToggleFavorite: () => void;
  onPlay: (request: PlayRequest) => void;
  onBack: () => void;
  playingKey?: string;
  /** Beside the player: a tighter hero. */
  compact?: boolean;
}) {
  const series = item.kind === "series";
  const local = item.series && "episodes" in item.series ? item.series.episodes : null;
  const [info, setInfo] = useState<TitleInfo | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(local);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const art = useArt({ kind: item.kind, name: item.name, year: item.info?.year });

  useEffect(() => {
    setInfo(null);
    setEpisodes(local);
    setError(null);
    setSeason(null);
    if (!xtream) return;
    const abort = new AbortController();
    const fail = (err: unknown) => !abort.signal.aborted && setError(err instanceof ListError ? err.message : "Não deu pra abrir");
    if (series && item.series && "xtreamId" in item.series) {
      xtream.episodes(item.series.xtreamId, abort.signal).then((r) => {
        setEpisodes(r.episodes);
        setInfo(r.info);
      }, fail);
    } else if (!series && /^m\d+$/.test(item.key)) {
      xtream.movieInfo(Number(item.key.slice(1)), abort.signal).then(setInfo, () => undefined);
    }
    return () => abort.abort();
  }, [item, xtream, series, local]);

  const poster = info?.poster ?? item.logo;
  const backdrop = info?.backdrop ?? art?.backdrop;
  const year = info?.year ?? item.info?.year;
  const rating = info?.rating ?? (Number(item.info?.rating) || undefined);
  const plot = info?.plot ?? item.info?.plot;
  const owner = { key: item.key, name: item.name, poster, kind: series ? ("series" as const) : ("movie" as const) };

  // Series: the next episode to watch is the one after the last finished, or the one in progress.
  const seasons = episodes ? seasonsOf(episodes) : [];
  const lastTouched = episodes
    ?.map((e) => ({ e, p: progress[e.key] }))
    .filter((x) => x.p)
    .sort((a, b) => b.p!.at - a.p!.at)[0];
  const upNext =
    episodes && lastTouched
      ? watched(lastTouched.p)
        ? (episodes[episodes.indexOf(lastTouched.e) + 1] ?? lastTouched.e)
        : lastTouched.e
      : episodes?.[0];
  const current = season ?? upNext?.season ?? seasons[0] ?? 1;
  const filmProgress = progress[item.key];

  const playFilm = (fromStart: boolean) =>
    item.play && onPlay({ play: item.play, key: item.key, start: fromStart ? 0 : filmProgress?.t, owner });
  const playEpisode = (e: Episode, fromStart = false) => onPlay({ play: e.play, key: e.key, start: fromStart ? 0 : progress[e.key]?.t, owner });

  const resumeFilm = !series && inProgress(filmProgress);
  const resumeEpisode = series && upNext && inProgress(progress[upNext.key]);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className={`relative isolate flex flex-col justify-end ${compact ? "min-h-56" : "min-h-[clamp(260px,42vh,440px)]"}`}>
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {backdrop ? (
            <img src={imageUrl(backdrop, "w1280")} alt="" className="size-full object-cover opacity-60" />
          ) : poster ? (
            <img src={imageUrl(poster, "w342")} alt="" className="size-full scale-125 object-cover opacity-35 blur-2xl" />
          ) : null}
          <div className="absolute inset-0 bg-linear-to-t from-canvas via-canvas/75 to-canvas/10" />
          <div className="absolute inset-0 bg-linear-to-r from-canvas/70 to-transparent" />
        </div>
        <button type="button" onClick={onBack} aria-label="Voltar" className="absolute top-4 left-6 grid size-10 lg:left-8 place-items-center rounded-full border-2 border-line bg-panel/80 text-ink backdrop-blur-md transition hover:bg-surface-hi">
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex items-end gap-6 px-6 pt-16 pb-6 lg:px-8">
          <Art kind={item.kind} name={item.name} src={poster} year={year} shape="poster" className={`aspect-[2/3] rounded-md border-2 border-line shadow-float ${compact ? "w-24" : "w-28 sm:w-40"}`} />
          <div className="min-w-0 flex-1">
            <p className="type-label text-accent-hi">{series ? "Série" : "Filme"} · {cleanLabel(item.group)}</p>
            <h1 className={`mt-1.5 font-display leading-[1.05] font-extrabold tracking-[-0.02em] text-balance ${compact ? "text-2xl" : "text-[28px] sm:text-[40px]"}`}>{item.name.replace(/\s*\((19|20)\d{2}\)\s*$/, "")}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {year && <span className={chip}>{year}</span>}
              {info?.duration && <span className={chip}>{info.duration}</span>}
              {rating && (
                <span className={chip}>
                  <Star className="size-3.5 fill-warn text-warn" /> {rating.toFixed(1).replace(".", ",")}
                </span>
              )}
              {series && seasons.length > 0 && <span className={chip}>{seasons.length === 1 ? "1 temporada" : `${seasons.length} temporadas`}</span>}
              {info?.genres.map((g) => (
                <span key={g} className={`${chip} text-soft`}>
                  {g}
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {!series && item.play && (
                <>
                  <Button variant="primary" onClick={() => playFilm(false)}>
                    <Play className="size-4 fill-current" /> {resumeFilm ? `Continuar de ${clock(filmProgress!.t)}` : "Assistir"}
                  </Button>
                  {resumeFilm && (
                    <Button onClick={() => playFilm(true)}>
                      <RotateCcw className="size-4" /> Do começo
                    </Button>
                  )}
                </>
              )}
              {series && upNext && (
                <Button variant="primary" onClick={() => playEpisode(upNext)}>
                  <Play className="size-4 fill-current" /> {resumeEpisode ? `Continuar T${upNext.season} E${upNext.episode}` : lastTouched ? `Assistir T${upNext.season} E${upNext.episode}` : "Assistir"}
                </Button>
              )}
              <Button square onClick={onToggleFavorite} aria-label={favorite ? "Tirar dos favoritos" : "Favoritar"} aria-pressed={favorite} title={favorite ? "Nos favoritos" : "Favoritar"}>
                <Heart className={`size-5 ${favorite ? "fill-accent text-accent" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-6 pb-10 lg:px-8">
        {plot && <p className="max-w-3xl text-[15px] leading-relaxed text-ink/85">{plot}</p>}
        {(info?.director || info?.cast) && (
          <dl className="grid max-w-3xl gap-1.5 text-sm">
            {info?.director && (
              <div className="flex gap-2">
                <dt className="shrink-0 font-bold">Direção</dt>
                <dd className="text-soft">{info.director}</dd>
              </div>
            )}
            {info?.cast && (
              <div className="flex gap-2">
                <dt className="shrink-0 font-bold">Elenco</dt>
                <dd className="line-clamp-2 text-soft">{info.cast}</dd>
              </div>
            )}
          </dl>
        )}

        {series && (
          <section>
            {!episodes && !error && (
              <div className="grid place-items-center py-10 text-soft">
                <Spinner className="size-6 text-accent-hi" />
              </div>
            )}
            {error && <p className="py-6 text-sm text-soft">{error}</p>}
            {seasons.length > 1 && (
              <div className="scrollbar-thin mb-3 flex gap-1.5 overflow-x-auto pb-1">
                {seasons.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeason(s)}
                    className={`type-link-sm h-9 shrink-0 rounded-full border-2 px-4 transition ${s === current ? "border-accent-hi bg-accent text-on-accent" : "border-line bg-surface text-soft hover:text-ink"}`}
                  >
                    Temporada {s}
                  </button>
                ))}
              </div>
            )}
            {episodes && episodes.length > 0 && (
              <p className="mb-2 text-xs text-soft">
                {episodes.filter((e) => e.season === current && watched(progress[e.key])).length} de {episodes.filter((e) => e.season === current).length} assistidos
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {episodes
                ?.filter((e) => e.season === current)
                .map((e) => {
                  const p = progress[e.key];
                  const playing = e.key === playingKey;
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => playEpisode(e)}
                      className={`group/ep flex items-center gap-3 rounded-md border-2 p-1.5 pr-3 text-left transition ${playing ? "border-accent bg-surface" : "border-transparent hover:bg-surface"}`}
                    >
                      <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-sm sm:w-40">
                        <Art kind="series" name={item.name} src={e.logo ?? poster} shape="still" className="size-full" />
                        <span className={`absolute inset-0 grid place-items-center bg-black/45 transition ${playing ? "opacity-100" : "opacity-0 group-hover/ep:opacity-100"}`}>
                          <Play className="size-6 fill-current" />
                        </span>
                        {p && (
                          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
                            <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (p.t / p.d) * 100)}%` }} />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          <span className="text-accent-hi">E{e.episode}</span> · {e.title}
                        </p>
                        {e.plot && <p className="line-clamp-2 text-xs text-soft">{e.plot}</p>}
                        {e.duration && !/^[0:]+$/.test(e.duration) && <p className="mt-0.5 text-[11px] text-soft/80">{e.duration.replace(/^00:/, "")}</p>}
                      </div>
                      {watched(p) && <Check className="size-4 shrink-0 text-accent-hi" aria-label="Assistido" />}
                    </button>
                  );
                })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
