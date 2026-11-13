import { Eye, EyeOff, FileUp, KeyRound, Link2, Server, Sparkles, User, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { catalogFromM3U } from "../lib/library";
import { parseM3U } from "../lib/m3u";
import { fetchText, ListError } from "../lib/net";
import { persistent, putText, type PlaylistConfig } from "../lib/storage";
import { normalizeServer, parseXtreamLink, Xtream } from "../lib/xtream";
import { Button, Field, inputClass, Segmented, Spinner, Wordmark } from "./ui";

type Mode = "link" | "file" | "xtream";

/** Free, legal channels (iptv-org): to try the plugin without a list of your own. */
const SAMPLE = { name: "Canais abertos (iptv-org)", url: "https://iptv-org.github.io/iptv/countries/br.m3u" };

const newId = () => Math.random().toString(36).slice(2, 10);

function hostName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Minha lista";
  }
}

/**
 * Adding a list: an M3U link, an M3U file, or an Xtream Codes login. Each is checked (downloaded, logged
 * into) before it's saved, so a list that won't open says why right here.
 */
export function AddPlaylist({ onAdded, onCancel }: { onAdded: (config: PlaylistConfig) => void; onCancel?: () => void }) {
  const [mode, setMode] = useState<Mode>("xtream");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const xtreamInLink = mode === "link" ? parseXtreamLink(link) : null;

  async function addXtream(login: { server: string; username: string; password: string }, label?: string) {
    setBusy("Entrando no servidor…");
    const xtream = new Xtream(login);
    await xtream.account();
    onAdded({ id: newId(), addedAt: Date.now(), type: "xtream", name: label || hostName(xtream.login.server), ...xtream.login });
  }

  async function addLink(url: string, label?: string) {
    const login = parseXtreamLink(url);
    if (login) {
      try {
        await addXtream(login, label);
        return;
      } catch (err) {
        // Some panels serve get.php but not the API: fall back to the list itself, unless the login is the problem.
        if (err instanceof ListError && /usuário|senha|venceu|bloqueou/i.test(err.message)) throw err;
      }
    }
    setBusy("Baixando a lista…");
    const text = await fetchText(url);
    setBusy("Lendo os canais…");
    const catalog = catalogFromM3U(parseM3U(text));
    if (!catalog.live && !catalog.movie && !catalog.series) throw new ListError("Nenhum canal nessa lista");
    const id = newId();
    await putText(id, text);
    onAdded({ id, addedAt: Date.now(), type: "m3u-url", name: label || hostName(url), url });
  }

  async function addFile(f: File, label?: string) {
    setBusy("Lendo o arquivo…");
    const text = await f.text();
    const catalog = catalogFromM3U(parseM3U(text));
    if (!catalog.live && !catalog.movie && !catalog.series) throw new ListError("Nenhum canal nesse arquivo");
    const id = newId();
    await putText(id, text);
    onAdded({ id, addedAt: Date.now(), type: "m3u-file", name: label || f.name.replace(/\.(m3u8?|txt)$/i, ""), fileName: f.name });
  }

  async function run(task: () => Promise<void>) {
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof ListError ? err.message : "Não deu pra carregar a lista");
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const label = name.trim();
    if (mode === "link") {
      const url = link.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return setError("Cole um link que comece com http:// ou https://");
      void run(() => addLink(url, label));
    } else if (mode === "file") {
      if (!file) return setError("Escolha o arquivo .m3u");
      void run(() => addFile(file, label));
    } else {
      if (!server.trim() || !username.trim() || !password) return setError("Preencha servidor, usuário e senha");
      let normalized: string;
      try {
        normalized = normalizeServer(server);
      } catch {
        return setError("Servidor inválido: use algo como http://servidor.com:8080");
      }
      void run(() => addXtream({ server: normalized, username: username.trim(), password }, label));
    }
  }

  return (
    <div className="bg-canvas grid size-full place-items-center overflow-y-auto p-4">
      <form
        onSubmit={submit}
        className="relative flex w-full max-w-md animate-pop flex-col gap-4 rounded-xl border border-white/[0.06] bg-panel/90 p-5 shadow-float backdrop-blur-xl sm:p-6"
      >
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label="Fechar" className="absolute top-3 right-3 grid size-9 place-items-center rounded-sm text-soft hover:bg-surface-hi hover:text-ink">
            <X className="size-4" />
          </button>
        )}
        <div className="flex items-center gap-3">
          <div>
            <Wordmark className="text-[28px]" />
            <h1 className="mt-3 font-display text-[22px] leading-[1.15] font-extrabold tracking-[-0.02em] text-balance">Carregue sua lista e assista com a sala.</h1>
            <p className="mt-1 text-sm text-soft">M3U, Xtream Codes ou arquivo: canais ao vivo, filmes e séries.</p>
          </div>
        </div>

        <Segmented
          label="Tipo de lista"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: "xtream", label: "Xtream", icon: Server },
            { value: "link", label: "Link M3U", icon: Link2 },
            { value: "file", label: "Arquivo", icon: FileUp },
          ]}
        />

        {mode === "xtream" && (
          <div className="flex flex-col gap-3">
            <Field label="Servidor (DNS)" htmlFor="iptv-server" icon={Server}>
              <input id="iptv-server" className={inputClass} value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://servidor.com:8080" autoComplete="url" inputMode="url" spellCheck={false} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Usuário" htmlFor="iptv-user" icon={User}>
                <input id="iptv-user" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
              </Field>
              <Field
                label="Senha"
                htmlFor="iptv-pass"
                icon={KeyRound}
                trailing={
                  <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Esconder senha" : "Mostrar senha"} className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-hi text-soft hover:text-ink">
                    {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              >
                <input id="iptv-pass" className={inputClass} type={reveal ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
            </div>
          </div>
        )}

        {mode === "link" && (
          <div className="flex flex-col gap-2">
            <Field label="Link da lista" htmlFor="iptv-link" icon={Link2}>
              <input id="iptv-link" className={inputClass} value={link} onChange={(e) => setLink(e.target.value)} placeholder="http://servidor/get.php?username=…" inputMode="url" spellCheck={false} />
            </Field>
            {xtreamInLink && (
              <p className="flex items-center gap-2 px-1 text-xs text-accent-hi">
                <Sparkles className="size-3.5 shrink-0" /> Link Xtream: abre com filmes, séries e guia separados.
              </p>
            )}
          </div>
        )}

        {mode === "file" && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/15 bg-surface px-4 py-7 text-center transition hover:border-accent/60 hover:bg-surface-hi"
          >
            <FileUp className="size-7 text-accent-hi" />
            <span className="type-link-sm">{file ? file.name : "Escolha ou arraste o arquivo .m3u"}</span>
            <span className="text-xs text-soft">{file ? `${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : ".m3u, .m3u8 ou .txt"}</span>
            <input ref={fileInput} type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </button>
        )}

        <Field label="Nome (opcional)" htmlFor="iptv-name">
          <input id="iptv-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: TV de casa" maxLength={40} />
        </Field>

        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-ink">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={!!busy} className="w-full">
          {busy ? (
            <>
              <Spinner className="size-4" /> {busy}
            </>
          ) : (
            "Carregar lista"
          )}
        </Button>

        <div className="flex flex-col items-center gap-1.5 text-center text-xs text-soft">
          <p>{persistent ? "Fica salva só neste navegador. Cada pessoa da sala usa a própria lista." : "Aqui o navegador não guarda nada: a lista vale só por esta sessão."}</p>
          <button type="button" disabled={!!busy} onClick={() => void run(() => addLink(SAMPLE.url, SAMPLE.name))} className="font-semibold text-accent-hi hover:underline disabled:opacity-50">
            Testar com canais abertos (iptv-org)
          </button>
        </div>
      </form>
    </div>
  );
}
