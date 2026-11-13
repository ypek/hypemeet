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
HYPETV_LISTS=Minha lista|http://servidor:8080|usuario|senha
```

Em produção é a mesma variável, nas envs do serviço no Dokploy. A lista aparece primeiro pra todo mundo, e o
login fica no servidor: a página só conhece `api/x/1` e usa `-` como usuário e senha (`server/lists.ts`).
Quem tiver o endereço do plugin assiste por essa conta, então use com uma sala de confiança.

Atrás de proxy corporativo com inspeção de TLS, rode o servidor com `bun --use-system-ca` (ou
`NODE_USE_SYSTEM_CA=1`).

```bash
bun test           # parser, Xtream, proxy, repasse e logos
bun run build      # tipos + build da página
```

## Na TV (Android TV e LG webOS)

Os dois apps abrem a página de TV do servidor, `https://hypetv.mihawkdev.com/tv/`: o mesmo HypeTv, num build
próprio (`vite build --mode tv`, em `dist/tv`) e no modo TV (`src/lib/tv.ts`):

- setas andam pelo foco (navegação espacial), OK aperta; o foco tem um anel grande, pra ver do sofá;
- Voltar fecha o que estiver aberto (lista de canais, modo cinema, página, busca) e na Início sai do app;
- no ao vivo: ↑/↓ e CH+/CH− trocam de canal, ← abre a lista ao lado da imagem; OK pausa;
- play/pause, parar, avançar e voltar do controle chegam no player de qualquer tela.

TVs têm navegador antigo (webOS 5 é Chromium 68), então esse build baixa a sintaxe, põe os polyfills e reescreve o
CSS do Tailwind v4 (`tv/web.ts`: `@layer`, propriedades lógicas, `:focus-visible`, `aspect-ratio`…).

```
tv/web.ts            o CSS do build de TV
tv/art.ts            ícones, banner e splash (os PNGs ficam no git)
tv/android/          app Android TV: WebView em tela cheia, banner na home da TV
tv/webos/            app LG webOS: appinfo.json e a página que abre o servidor
```

```bash
tv/android/build.sh                          # → tv/out/HypeTv-androidtv-<versão>.apk (Android SDK + JDK 17+)
tv/webos/build.sh                            # → tv/out/com.mihawkdev.hypetv_<versão>_all.ipk (npm i -g @webos-tools/cli)
```

A chave que assina o APK nasce no primeiro build em `tv/android/signing/` (fora do git). Guarde: atualização só
instala por cima se for assinada com a mesma chave.

Instalar:

- **Android TV**: copie o `.apk` pra TV (pendrive, ou um app como o "Send files to TV") e abra num gerenciador de
  arquivos, permitindo "instalar apps desconhecidos"; ou, com a depuração USB/rede ligada,
  `adb connect <ip-da-tv>` e `adb install -r HypeTv-androidtv-1.0.0.apk`. Aparece na home da TV.
- **LG webOS**: ative o Modo Desenvolvedor na TV (app "Developer Mode" da LG Content Store, conta LG developer), e
  aí `ares-setup-device` (IP da TV e a passphrase que o app mostra) e
  `ares-install -d <tv> com.mihawkdev.hypetv_1.0.0_all.ipk`. A sessão do Modo Desenvolvedor vale 50 horas e pode
  ser renovada no app.

## Variáveis

| Variável | Pra quê |
|---|---|
| `HYPETV_LISTS` | Listas que todo mundo já recebe: `Nome\|http://servidor:8080\|usuario\|senha`, várias separadas por `;`. O login nunca vai pro navegador. |
| `HYPETV_CACHE_GB` | Espaço pros filmes compartilhados (padrão 20; `0` desliga). Cada filme é baixado uma vez, numa conexão, e a sala toda assiste dessa cópia. |
| `HYPETV_CACHE_DIR` | Onde ficam essas cópias (padrão: pasta temporária; no Docker, `/cache`). |
| `TMDB_API_KEY` | Capas de filmes e séries que a lista não tem (chave v3 ou token v4). Sem ela, Wikipedia. |
| `HYPETV_HOSTS` | Hosts IPTV que o proxy aceita (e subdomínios), separados por vírgula. Vazio: qualquer host público. |
| `HYPETV_MAX_STREAMS` | Streams abertos ao mesmo tempo no proxy (padrão 40). |
| `HYPETV_COUNTRY` | País preferido nos logos (padrão `BR`). |
| `HYPETV_ALLOW_PRIVATE` | `1` deixa o proxy ir a endereços privados (já é assim fora de produção). |
