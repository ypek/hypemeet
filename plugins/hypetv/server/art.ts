/**
 * Logos and covers for everything in a list. Lists come with artwork of their own, but it's often on hosts that
 * break (imgur refuses hotlinks, resellers' image hosts go down) or is missing; here we find a proper one:
 *
 *   channels      → the iptv-org database (https://github.com/iptv-org/database): 30k+ channels with logos,
 *                   matched by tvg-id or by a cleaned-up name ("RECORD SP FHD [ALT]" → "record sp" → "record")
 *   films, series → TMDB (TMDB_API_KEY: a v3 key or a v4 read token), else Wikipedia's page image
 *
 * Results are cached in memory; the client asks in batches for what's on screen.
 */

const IPTV_ORG = "https://iptv-org.github.io/api";
const INDEX_TTL_MS = 24 * 3600_000;
const CACHE_MAX = 100_000;
const UA = "HypeTv/0.1 (HypeMeet plugin; +https://github.com/ypek/hypemeet)";

export type ArtKind = "live" | "movie" | "series";

export interface ArtQuery {
  kind: ArtKind;
  name: string;
  year?: string;
  /** M3U tvg-id, e.g. "Globo.br@SD". */
  tvgId?: string;
}

export interface Art {
  /** Logo (channels) or poster (films, series). */
  image?: string;
  /** More logos to try, in order, when `image` won't load (a host that blocks the viewer, say). */
  alts?: string[];
  backdrop?: string;
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Tags lists hang on channel names: quality, codec, backups, country prefixes. */
const CHANNEL_NOISE =
  /\b(f?hd|sd|uhd|4k|8k|hevc|h\.?26[45]|x26[45]|\d{3,4}p|\d{2}fps|alt|backup|reserva|opcao\s*\d|op\d|legendado|dublado|leg|dub)\b|[²³¹⁴]/g;

/** "BR: RECORD SP FHD [ALT]" → "record sp" */
export function channelKey(name: string): string {
  return fold(name)
    .replace(/^\s*[a-z]{2}\s*[:|-]\s+/, "") // "BR: ", "PT | "
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(CHANNEL_NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** What to search a film or show by: the title without year, quality and language tags, plus the year. */
export function cleanTitle(raw: string, year?: string): { title: string; year?: string } {
  let text = raw;
  const y = /\((19|20)\d{2}\)/.exec(text) ?? /[\s-](19|20)\d{2}\s*$/.exec(text);
  const found = y?.[0].replace(/\D/g, "");
  text = text
    .replace(/\((19|20)\d{2}\)/g, " ")
    .replace(/[[{][^\]}]*[\]}]/g, " ")
    .replace(/^\s*[A-Z]{2}\s*[:|]\s+/, "")
    .replace(/\b(4K|UHD|FHD|HD|SD|HDR|1080p|720p|480p|H\.?26[45]|HEVC|x26[45]|dublado|legendado|dual(\s*[aá]udio)?|nacional)\b/gi, " ")
    .replace(/\bS\d{1,2}\s*E\d{1,3}\b.*$/i, " ")
    .replace(/[\s-]+(19|20)\d{2}\s*$/, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|-]+|[\s:|-]+$/g, "");
  const yr = year && /^(19|20)\d{2}$/.test(year) ? year : found;
  return yr ? { title: text, year: yr } : { title: text };
}

/** Adult entries keep their own artwork: nothing to look up for them. */
export const isAdult = (name: string) => /\[(xxx|adulto?s?)\]|\bxxx\b|\+18\b/i.test(name);

/** "[24H] Os Simpsons 34": a channel looping a show, best pictured by the show's poster. */
export const isLoopChannel = (name: string) => /\[\s*24\s*h(oras)?\s*\]|^\s*24h\b/i.test(name);

interface LogoEntry {
  url: string;
  /** ISO 3166 code, upper case; "" when unknown. */
  country: string;
}

export interface LogoIndex {
  /** iptv-org channel id → logo (tvg-id lookups). */
  byId: Map<string, string>;
  /** channelKey → logos, also without spaces ("apple tv plus" and "appletvplus"). */
  byName: Map<string, LogoEntry[]>;
  /** First word → its names, shortest first: affiliates found by brand. */
  byBrand: Map<string, (LogoEntry & { key: string })[]>;
}

function buildIndex(entries: { names: string[]; url: string; country: string; id?: string }[]): LogoIndex {
  const byId = new Map<string, string>();
  const byName = new Map<string, LogoEntry[]>();
  for (const e of entries) {
    if (e.id) byId.set(e.id, e.url);
    for (const n of e.names) {
      const key = channelKey(n);
      if (!key) continue;
      for (const k of new Set([key, key.replace(/ /g, "")])) {
        const list = byName.get(k) ?? [];
        if (!list.some((x) => x.url === e.url)) list.push({ url: e.url, country: e.country });
        byName.set(k, list);
      }
    }
  }
  const byBrand = new Map<string, (LogoEntry & { key: string })[]>();
  for (const [key, hits] of byName) {
    const space = key.indexOf(" ");
    if (space === -1) continue;
    const list = byBrand.get(key.slice(0, space)) ?? [];
    for (const h of hits) list.push({ key, ...h });
    byBrand.set(key.slice(0, space), list);
  }
  for (const list of byBrand.values()) list.sort((a, b) => a.key.length - b.key.length);
  return { byId, byName, byBrand };
}

async function getJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const res = await fetcher(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** iptv-org: channels (names, alt names, country) and their logos. Many of these live on imgur. */
export async function loadLogoIndex(fetcher: typeof fetch = fetch): Promise<LogoIndex> {
  const [channels, logos] = (await Promise.all(["channels", "logos"].map((f) => getJson(fetcher, `${IPTV_ORG}/${f}.json`)))) as Record<string, unknown>[][];
  const logoOf = new Map<string, string>();
  // Per channel: the channel's own logo over a feed's (a regional or HD variant), then the widest; none marked unused.
  const score = new Map<string, number>();
  for (const l of logos!) {
    const id = String(l.channel ?? "");
    const url = String(l.url ?? "");
    if (!id || !/^https:\/\//.test(url) || l.in_use === false) continue;
    const sc = (l.feed ? 0 : 1e6) + (Number(l.width) || 0);
    if (!logoOf.has(id) || sc > (score.get(id) ?? 0)) logoOf.set(id, url), score.set(id, sc);
  }
  return buildIndex(
    channels!.flatMap((c) => {
      const id = String(c.id ?? "");
      const url = logoOf.get(id);
      if (!url || c.closed) return [];
      return [{ id, url, country: String(c.country ?? "").toUpperCase(), names: [c.name, ...(Array.isArray(c.alt_names) ? c.alt_names : [])].map(String) }];
    }),
  );
}

const TV_LOGOS = "tv-logo/tv-logos";
const TV_LOGOS_CDN = `https://cdn.jsdelivr.net/gh/${TV_LOGOS}@main/`;

/**
 * tv-logo/tv-logos: ~10k logos by country, named "<channel>-<cc>.png" ("record-br.png"), served from GitHub by
 * jsDelivr. Fewer channels than iptv-org but clean, consistent artwork on a host that doesn't refuse hotlinks.
 */
export async function loadTvLogos(fetcher: typeof fetch = fetch): Promise<LogoIndex> {
  const tree = (await getJson(fetcher, `https://api.github.com/repos/${TV_LOGOS}/git/trees/main?recursive=1`)) as { tree?: { path: string; type: string }[] };
  const entries = [];
  for (const { path, type } of tree.tree ?? []) {
    const m = type === "blob" ? /^countries\/[^/]+\/(.+?)(?:-([a-z]{2,3}))?\.(png|svg)$/i.exec(path) : null;
    if (!m) continue;
    entries.push({ url: TV_LOGOS_CDN + path.split("/").map(encodeURIComponent).join("/"), country: (m[2] ?? "").toUpperCase(), names: [m[1]!.replace(/-/g, " ")] });
  }
  return buildIndex(entries);
}

/**
 * Exact cleaned name, then dropping trailing words one at a time: a regional affiliate ("globo eptv sao carlos")
 * or a numbered feed ("premiere 5") ends up on its network's logo. Spaces are ignored on a second try. Country
 * first among equals.
 */
export function findLogo(index: LogoIndex, name: string, tvgId: string | undefined, country: string): string | undefined {
  if (tvgId) {
    const direct = index.byId.get(tvgId.split("@")[0]!);
    if (direct) return direct;
  }
  if (isLoopChannel(name) || isAdult(name)) return undefined;
  const words = channelKey(name).split(" ").filter(Boolean);
  for (let keep = words.length; keep >= 1; keep--) {
    const key = words.slice(0, keep).join(" ");
    if (key.length < 3) break;
    const hits = index.byName.get(key) ?? index.byName.get(key.replace(/ /g, ""));
    if (hits?.length) return (hits.find((h) => h.country === country) ?? hits[0]!).url;
  }
  // Only affiliates in the database ("sbt sao paulo" for "sbt"): the shortest one of our country starting with the brand.
  const brand = words[0];
  if (!brand || brand.length < 3 || GENERIC.has(brand)) return undefined;
  return index.byBrand.get(brand)?.find((h) => h.country === country)?.url;
}

/** First words too common to stand for a brand. */
const GENERIC = new Set(["tv", "canal", "rede", "cine", "radio", "the", "channel", "sinal", "live", "ao", "vivo", "filmes", "series"]);

const TMDB_IMG = "https://image.tmdb.org/t/p";

async function tmdb(key: string, q: ArtQuery): Promise<Art | null> {
  const { title, year } = cleanTitle(q.name, q.year);
  if (!title) return null;
  const tv = q.kind === "series";
  const params = new URLSearchParams({ query: title, language: "pt-BR", include_adult: "false" });
  if (year) params.set(tv ? "first_air_date_year" : "year", year);
  const bearer = key.length > 40;
  if (!bearer) params.set("api_key", key);
  const res = await fetch(`https://api.themoviedb.org/3/search/${tv ? "tv" : "movie"}?${params}`, {
    headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { poster_path?: string | null; backdrop_path?: string | null }[] };
  const hit = data.results?.find((r) => r.poster_path) ?? (year ? null : undefined);
  if (!hit) return year ? tmdb(key, { ...q, year: undefined, name: title }) : null;
  return {
    image: hit.poster_path ? `${TMDB_IMG}/w342${hit.poster_path}` : undefined,
    backdrop: hit.backdrop_path ? `${TMDB_IMG}/w780${hit.backdrop_path}` : undefined,
  };
}

async function wikipedia(q: ArtQuery): Promise<Art | null> {
  const { title, year } = cleanTitle(q.name, q.year);
  if (!title) return null;
  for (const lang of ["pt", "en"]) {
    const what = q.kind === "series" ? (lang === "pt" ? "série" : "TV series") : lang === "pt" ? "filme" : "film";
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: `${title} ${year ?? ""} ${what}`.trim(),
      gsrlimit: "1",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "500",
    });
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) continue;
    const data = (await res.json()) as { query?: { pages?: Record<string, { thumbnail?: { source?: string } }> } };
    const page = Object.values(data.query?.pages ?? {})[0];
    if (page?.thumbnail?.source) return { image: page.thumbnail.source };
  }
  return null;
}

/** Image hosts that refuse hotlinks or whole networks (HTTP 499 from imgur and ImgBB). */
const BLOCKY_HOSTS = /^https?:\/\/([a-z0-9-]+\.)?(imgur\.com|ibb\.co)\//i;

/** Sports events and the like ("(11) ⏰ 17:00 • Salamanca x Celta"): a match, not a channel with a logo. */
export const isEventChannel = (name: string) => /⏰|•|\b\d{1,2}[:h]\d{2}\b|\bx\b.*\bx\b|^\s*\(\d+\)/i.test(name) || / x /i.test(channelKey(name));

/**
 * Channels neither logo database knows: the Wikipedia article's image, from a search for the cleaned name as a TV
 * channel. Only an article whose title has the channel's first word is trusted, so an unrelated page never lends
 * its picture.
 */
async function wikipediaLogo(name: string): Promise<string | null> {
  const words = channelKey(name).split(" ").filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const brand = words.find((w) => !GENERIC.has(w));
  if (!brand || brand.length < 3) return null;
  const query = words.slice(0, 4).join(" ");
  for (const [lang, what] of [
    ["pt", "canal de televisão"],
    ["en", "television channel"],
  ] as const) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: `${query} ${what}`,
      gsrlimit: "3",
      prop: "pageimages",
      piprop: "thumbnail",
      pithumbsize: "400",
    });
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) continue;
    const data = (await res.json()) as { query?: { pages?: Record<string, { title?: string; index?: number; thumbnail?: { source?: string } }> } };
    const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const hit = pages.find((p) => p.thumbnail?.source && channelKey(p.title ?? "").split(" ").includes(brand));
    if (hit) return hit.thumbnail!.source!;
  }
  return null;
}

/** At most this many TMDB/Wikipedia lookups at once (each answer is cached). */
const LOOKUPS = 6;

export function createArt({ tmdbKey, country = "BR" }: { tmdbKey?: string; country?: string }) {
  const cache = new Map<string, Art | null>();
  const inflight = new Map<string, Promise<Art | null>>();
  let running = 0;
  const queue: (() => void)[] = [];
  const slot = async () => {
    if (running >= LOOKUPS) await new Promise<void>((r) => queue.push(r));
    running++;
  };
  const release = () => {
    running--;
    queue.shift()?.();
  };

  /** Kept for a day; a failed download is retried on the next request instead. An index that can't load counts as empty. */
  const daily = (load: () => Promise<LogoIndex>) => {
    let index: Promise<LogoIndex> | null = null;
    let at = 0;
    return (): Promise<LogoIndex | null> => {
      if (!index || Date.now() - at > INDEX_TTL_MS) {
        at = Date.now();
        index = load();
        index.catch((err: Error) => {
          console.error(`logos: ${err.message}`);
          index = null;
        });
      }
      return index.catch(() => null);
    };
  };
  const tvLogos = daily(() => loadTvLogos());
  const iptvOrg = daily(() => loadLogoIndex());

  async function lookup(q: ArtQuery): Promise<Art | null> {
    if (q.kind === "live") {
      const [clean, wide] = await Promise.all([tvLogos(), iptvOrg()]);
      // tv-logos first: same style throughout and hosted where hotlinks work; iptv-org covers far more channels.
      const found = [...new Set([clean && findLogo(clean, q.name, undefined, country), wide && findLogo(wide, q.name, q.tvgId, country)])].filter(
        (u): u is string => !!u,
      );
      // Only on hosts that turn many viewers (and servers) away: Wikipedia's picture as one more to try.
      if (found.length && found.every((u) => BLOCKY_HOSTS.test(u)) && !isAdult(q.name)) {
        await slot();
        const extra = await wikipediaLogo(q.name).catch(() => null).finally(release);
        if (extra) found.push(extra);
      }
      if (found.length) return { image: found[0], alts: found.slice(1) };
      // Unknown to both databases: Wikipedia. A channel looping a show gets the show's poster instead; events and
      // adult channels keep the list's own image.
      if (!isLoopChannel(q.name)) {
        if (isEventChannel(q.name) || isAdult(q.name)) return null;
        await slot();
        try {
          const logo = await wikipediaLogo(q.name).catch(() => null);
          return logo ? { image: logo } : null;
        } finally {
          release();
        }
      }
      q = { kind: "series", name: q.name.replace(/\[[^\]]*\]/g, " ").replace(/\s\d{1,2}\s*$/, " ").trim() };
    }
    if (isAdult(q.name)) return null;
    await slot();
    try {
      return (tmdbKey ? await tmdb(tmdbKey, q).catch(() => null) : null) ?? (await wikipedia(q).catch(() => null));
    } finally {
      release();
    }
  }

  return {
    sources: { tmdb: !!tmdbKey },
    /** Downloads the channel logo index ahead of the first request. */
    warm: () => void Promise.all([tvLogos(), iptvOrg()]),
    async resolve(q: ArtQuery): Promise<Art | null> {
      const key = q.kind === "live" ? `live\u0000${q.tvgId ?? ""}\u0000${channelKey(q.name)}` : `${q.kind}\u0000${fold(cleanTitle(q.name, q.year).title)}\u0000${q.year ?? ""}`;
      if (cache.has(key)) return cache.get(key)!;
      let pending = inflight.get(key);
      if (!pending) {
        pending = lookup(q).catch(() => null);
        inflight.set(key, pending);
      }
      const art = await pending;
      inflight.delete(key);
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, art);
      return art;
    },
  };
}
