/**
 * A fake Xtream Codes panel for trying the plugin without a real list (bun run mock → http://localhost:5176,
 * user "demo", password "demo"). Channels, films and series point at public test videos:
 *
 *   /live/demo/demo/<id>.m3u8  → a public HLS test stream
 *   /live/demo/demo/<id>.ts    → the same stream as continuous MPEG-TS (its segments in a loop), like a panel
 *   /movie|series/demo/demo/<id>.mp4 → a public MP4
 *
 * In dev the plugin's relay accepts localhost, so add it as an Xtream list with server http://localhost:5176.
 */
const PORT = Number(process.env.MOCK_PORT ?? 5176);
const USER = "demo";
const PASS = "demo";
const HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
const MP4 = ["https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4", "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"];

const poster = (text: string) => `https://placehold.co/300x450/191926/8b93ff.png?text=${encodeURIComponent(text.split(" ").slice(0, 2).join("\n"))}`;
const logo = (text: string) => `https://placehold.co/96x96/1e2353/ffffff.png?text=${encodeURIComponent(text.slice(0, 3))}`;

const LIVE_CATS = ["Abertos", "Esportes", "Notícias", "Filmes 24h", "Infantil", "Documentários", "Música", "Internacionais"];
const VOD_CATS = ["Lançamentos", "Ação", "Comédia", "Drama", "Terror", "Animação", "Nacionais"];
const SERIES_CATS = ["Netflix", "HBO", "Novelas", "Animes"];
const WORDS = ["Noite", "Fogo", "Cidade", "Último", "Sombra", "Rio", "Estrela", "Código", "Tempo", "Mar", "Lobo", "Vento", "Ouro", "Sangue", "Luz"];
const word = (n: number) => WORDS[n % WORDS.length]!;

const live = Array.from({ length: 320 }, (_, i) => ({
  num: i + 1,
  name: `${LIVE_CATS[i % LIVE_CATS.length]!.split(" ")[0]} ${i + 1}${i % 3 ? " HD" : " FHD"}`,
  stream_type: "live",
  stream_id: 1000 + i,
  stream_icon: i % 5 ? logo(`C${i + 1}`) : "",
  epg_channel_id: null,
  category_id: String(1 + (i % LIVE_CATS.length)),
}));
const vod = Array.from({ length: 2400 }, (_, i) => ({
  num: i + 1,
  name: `${word(i)} ${word(i * 7 + 3)} (${2000 + (i % 27)})`,
  stream_type: "movie",
  stream_id: 5000 + i,
  stream_icon: poster(`${word(i)} ${word(i * 7 + 3)}`),
  rating: ((i * 37) % 50) / 10 + 5,
  year: String(2000 + (i % 27)),
  category_id: String(10 + (i % VOD_CATS.length)),
  container_extension: "mp4",
}));
const series = Array.from({ length: 180 }, (_, i) => ({
  num: i + 1,
  name: `${word(i * 3)} ${word(i + 5)}`,
  series_id: 900 + i,
  cover: poster(`${word(i * 3)} ${word(i + 5)}`),
  plot: "Uma série de teste do servidor Xtream de mentira do plugin.",
  year: String(2010 + (i % 15)),
  rating: "7.8",
  category_id: String(30 + (i % SERIES_CATS.length)),
}));

const cats = (names: string[], first: number) => names.map((category_name, i) => ({ category_id: String(first + i), category_name, parent_id: 0 }));
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function api(params: URLSearchParams): unknown {
  if (params.get("username") !== USER || params.get("password") !== PASS) return { user_info: { auth: 0 } };
  const now = Math.floor(Date.now() / 1000);
  switch (params.get("action")) {
    case null:
      return {
        user_info: { username: USER, password: PASS, auth: 1, status: "Active", exp_date: String(now + 86400 * 365), max_connections: "1", allowed_output_formats: ["m3u8", "ts"] },
        server_info: { url: "localhost", port: String(PORT) },
      };
    case "get_live_categories":
      return cats(LIVE_CATS, 1);
    case "get_vod_categories":
      return cats(VOD_CATS, 10);
    case "get_series_categories":
      return cats(SERIES_CATS, 30);
    case "get_live_streams":
      return live;
    case "get_vod_streams":
      return vod;
    case "get_series":
      return series;
    case "get_series_info": {
      const id = Number(params.get("series_id"));
      const show = series.find((s) => s.series_id === id);
      const episodes: Record<string, unknown[]> = {};
      for (let s = 1; s <= 1 + (id % 3); s++)
        episodes[s] = Array.from({ length: 6 + (id % 5) }, (_, e) => ({
          id: String(id * 1000 + s * 100 + e + 1),
          episode_num: e + 1,
          season: s,
          title: `${word(e + s)} no ${word(e * 2 + id)}`,
          container_extension: "mp4",
          info: { duration: "00:42:00", plot: "Episódio de teste." },
        }));
      return { info: { name: show?.name ?? "Série", cover: show?.cover, plot: show?.plot }, episodes };
    }
    case "get_short_epg": {
      const start = now - (now % 3600);
      return {
        epg_listings: [0, 1, 2].map((k) => ({
          title: b64(["Jornal da Manhã", "Futebol ao Vivo", "Sessão da Tarde"][k]!),
          description: b64("Programa de teste"),
          start_timestamp: String(start + k * 3600),
          stop_timestamp: String(start + (k + 1) * 3600),
        })),
      };
    }
  }
  return [];
}

/** The test HLS stream's segments, once: what a panel sends as a .ts live channel. */
let segments: Promise<{ url: string; duration: number }[]> | null = null;
async function loadSegments() {
  const master = await (await fetch(HLS)).text();
  const variant = new URL(master.split("\n").find((l) => l && !l.startsWith("#"))!, HLS);
  const media = await (await fetch(variant)).text();
  const out: { url: string; duration: number }[] = [];
  let duration = 10;
  for (const line of media.split("\n")) {
    if (line.startsWith("#EXTINF:")) duration = Number.parseFloat(line.slice(8));
    else if (line && !line.startsWith("#")) out.push({ url: new URL(line, variant).href, duration });
  }
  return out;
}

function tsLoop(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const list = await (segments ??= loadSegments());
      for (let i = 0; !signal.aborted; i = (i + 1) % list.length) {
        const started = performance.now();
        try {
          controller.enqueue(new Uint8Array(await (await fetch(list[i]!.url, { signal })).arrayBuffer()));
        } catch {
          break;
        }
        // Real time, roughly: one segment per segment duration (the first two straight away, to fill the buffer).
        if (i > 1) await Bun.sleep(Math.max(0, list[i]!.duration * 1000 - (performance.now() - started)));
      }
      try {
        controller.close();
      } catch {
        // client gone
      }
    },
  });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/player_api.php") return Response.json(api(url.searchParams));
    const m = /^\/(live|movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.(\w+)$/.exec(url.pathname);
    if (!m) return new Response("not found", { status: 404 });
    const [, kind, user, pass, id, ext] = m;
    if (user !== USER || pass !== PASS) return new Response("<html>INVALID_CREDENTIALS</html>", { headers: { "content-type": "text/html" } });
    if (kind === "live" && ext === "m3u8") return Response.redirect(HLS, 302);
    if (kind === "live") return new Response(tsLoop(req.signal), { headers: { "content-type": "video/mp2t" } });
    return Response.redirect(MP4[Number(id) % MP4.length]!, 302);
  },
});
console.log(`mock Xtream on http://localhost:${server.port} (user ${USER}, password ${PASS})`);
