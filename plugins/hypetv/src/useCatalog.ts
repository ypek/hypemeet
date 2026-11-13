import { useCallback, useEffect, useRef, useState } from "react";
import { catalogFromM3U } from "./lib/library";
import { parseM3U } from "./lib/m3u";
import { fetchText, ListError } from "./lib/net";
import { getText, putText, type PlaylistConfig } from "./lib/storage";
import type { Catalog, Kind } from "./lib/types";
import { Xtream, type XtreamAccount } from "./lib/xtream";

type Load = "loading" | "ready" | "error";

export interface CatalogState {
  status: Load;
  error?: string;
  catalog: Catalog;
  /** Tabs this list has (an Xtream list has all three, filled when opened). */
  kinds: Kind[];
  sections: Partial<Record<Kind, { status: Load; error?: string }>>;
  xtream?: Xtream;
  account?: XtreamAccount;
  loadSection(kind: Kind): void;
  refresh(): void;
}

const reasonOf = (err: unknown) => (err instanceof ListError ? err.message : "Não deu pra carregar a lista");

/** Reads a list into a catalogue; M3U texts are kept (IndexedDB) so reopening doesn't download it again. */
export async function loadM3U(config: PlaylistConfig, fresh: boolean, signal?: AbortSignal): Promise<Catalog> {
  let text = fresh ? undefined : await getText(config.id);
  if (text === undefined) {
    if (config.type === "m3u-file") throw new ListError("O arquivo dessa lista não está mais neste navegador: adicione de novo");
    if (config.type !== "m3u-url") throw new ListError("Lista inválida");
    text = await fetchText(config.url, signal);
    void putText(config.id, text);
  }
  const catalog = catalogFromM3U(parseM3U(text));
  if (!catalog.live && !catalog.movie && !catalog.series) throw new ListError("Nenhum canal nessa lista");
  return catalog;
}

export function useCatalog(config: PlaylistConfig | null): CatalogState {
  const [state, setState] = useState<Omit<CatalogState, "loadSection" | "refresh">>({ status: "loading", catalog: {}, kinds: [], sections: {} });
  const [round, setRound] = useState({ n: 0, fresh: false });
  const xtreamRef = useRef<Xtream | undefined>(undefined);
  const inflight = useRef(new Map<Kind, AbortController>());

  useEffect(() => {
    if (!config) return;
    const abort = new AbortController();
    for (const c of inflight.current.values()) c.abort();
    inflight.current.clear();
    xtreamRef.current = undefined;
    setState({ status: "loading", catalog: {}, kinds: [], sections: {} });
    (async () => {
      if (config.type === "xtream") {
        const xtream = new Xtream(config);
        const account = await xtream.account(abort.signal);
        xtreamRef.current = xtream;
        setState({ status: "ready", catalog: {}, kinds: ["live", "movie", "series"], sections: {}, xtream, account });
        return;
      }
      const catalog = await loadM3U(config, round.fresh, abort.signal);
      const kinds = (["live", "movie", "series"] as const).filter((k) => catalog[k]);
      setState({ status: "ready", catalog, kinds, sections: Object.fromEntries(kinds.map((k) => [k, { status: "ready" }])) });
    })().catch((err: unknown) => {
      if (!abort.signal.aborted) setState({ status: "error", error: reasonOf(err), catalog: {}, kinds: [], sections: {} });
    });
    return () => abort.abort();
  }, [config, round]);

  const loadSection = useCallback((kind: Kind) => {
    const xtream = xtreamRef.current;
    if (!xtream || inflight.current.has(kind)) return;
    const abort = new AbortController();
    inflight.current.set(kind, abort);
    setState((s) => ({ ...s, sections: { ...s.sections, [kind]: { status: "loading" } } }));
    xtream.section(kind, abort.signal).then(
      (section) => {
        if (xtreamRef.current !== xtream) return;
        setState((s) => ({ ...s, catalog: { ...s.catalog, [kind]: section }, sections: { ...s.sections, [kind]: { status: "ready" } } }));
      },
      (err: unknown) => {
        inflight.current.delete(kind);
        if (abort.signal.aborted || xtreamRef.current !== xtream) return;
        setState((s) => ({ ...s, sections: { ...s.sections, [kind]: { status: "error", error: reasonOf(err) } } }));
      },
    );
  }, []);

  const refresh = useCallback(() => setRound((r) => ({ n: r.n + 1, fresh: true })), []);
  return { ...state, loadSection, refresh };
}
