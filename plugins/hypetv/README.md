# HypeTv

O [IPTVnator](https://github.com/4gray/iptvnator) como plugin do HypeMeet (veja a seção "HypeTv" no README do
repositório). React + Tailwind com o tema do HypeMeet, hls.js e mpegts.js no player, e um servidor Bun com o
proxy e a busca de logos e capas.

```
src/                 a página (o plugin que a sala abre num iframe)
  lib/m3u.ts         listas M3U (atributos tvg-*, #EXTVLCOPT, |User-Agent=)
  lib/xtream.ts      API Xtream Codes (player_api.php)
  lib/engine.ts      HLS / MPEG-TS / arquivo, com tentativas pelo proxy
  lib/together.ts    "Passar pra sala": mensagens entre as cópias do plugin
server/              o serviço
  proxy.ts           só endereços públicos, reescrita de playlists HLS
  fanout.ts          um canal ao vivo, uma conexão, pra todo mundo da sala
  art.ts             logos (tv-logos, iptv-org, Wikipedia) e capas (TMDB, Wikipedia)
dev/mock-xtream.ts   um painel Xtream de mentira pra testar sem lista
```

## Rodando

```bash
bun install
bun run dev        # servidor na 5175 + Vite na 5174
bun run mock       # opcional: Xtream de teste em http://localhost:5176 (usuário demo, senha demo)
```

Na sala: rode o HypeMeet com `PLUGINS=http://localhost:5174` (o plugin precisa de outra origem que não a da sala).
Aberto direto em http://localhost:5174 ele funciona sozinho, sem o "passar pra sala".

Pra já abrir com uma lista sua, crie `plugins/hypetv/.env.local` (fica fora do git) com:

```
HYPETV_DEV_XTREAM=Minha lista|http://servidor:8080|usuario|senha
```

Só em dev: em produção essa rota não existe.

Atrás de proxy corporativo com inspeção de TLS, rode o servidor com `bun --use-system-ca` (ou
`NODE_USE_SYSTEM_CA=1`).

```bash
bun test           # parser, Xtream, proxy, repasse e logos
bun run build      # tipos + build da página
```

## Variáveis

| Variável | Pra quê |
|---|---|
| `TMDB_API_KEY` | Capas de filmes e séries que a lista não tem (chave v3 ou token v4). Sem ela, Wikipedia. |
| `HYPETV_HOSTS` | Hosts IPTV que o proxy aceita (e subdomínios), separados por vírgula. Vazio: qualquer host público. |
| `HYPETV_MAX_STREAMS` | Streams abertos ao mesmo tempo no proxy (padrão 40). |
| `HYPETV_COUNTRY` | País preferido nos logos (padrão `BR`). |
| `HYPETV_ALLOW_PRIVATE` | `1` deixa o proxy ir a endereços privados (já é assim fora de produção). |
