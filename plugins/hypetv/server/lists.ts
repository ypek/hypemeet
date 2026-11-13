/**
 * Lists the server offers to everyone who opens HypeTv (HYPETV_LISTS), with the login kept here: the page knows
 * them as `api/x/<id>` and the real server, user and password are put in when the request goes out. The page
 * talks to it like any Xtream panel, with "-" for user and password.
 *
 *   HYPETV_LISTS="Name|http://server:8080|user|password; Other|…"
 *
 *   api/x/1/player_api.php?username=-&password=-&action=…  →  <server>/player_api.php?username=<user>&password=<pass>&action=…
 *   api/x/1/live/-/-/123.ts                                  →  <server>/live/<user>/<pass>/123.ts
 */

export interface ServerList {
  id: string;
  name: string;
  server: string;
  username: string;
  password: string;
}

/** What the page gets: no server, no login. */
export interface PublicList {
  id: string;
  name: string;
}

export const PLACEHOLDER = "-";

export function parseLists(raw: string | undefined): ServerList[] {
  return (raw ?? "")
    .split(";")
    .map((entry) => entry.split("|").map((p) => p.trim()))
    .filter((parts) => parts.length === 4 && parts.every(Boolean))
    .flatMap(([name, server, username, password], i) => {
      try {
        const url = new URL(/^https?:\/\//i.test(server!) ? server! : `http://${server}`);
        const base = `${url.protocol}//${url.host}${url.pathname.replace(/\/(player_api|get)\.php$/i, "").replace(/\/+$/, "")}`;
        return [{ id: String(i + 1), name: name!, server: base, username: username!, password: password! }];
      } catch {
        console.error(`HYPETV_LISTS: ignoring "${name}", invalid server`);
        return [];
      }
    });
}

export const publicLists = (lists: ServerList[]): PublicList[] => lists.map(({ id, name }) => ({ id, name }));

export type Upstream = { kind: "api"; url: URL } | { kind: "stream"; url: URL; live: boolean };

/** The panel URL behind `api/x/<id>/<path>?<query>`, or null when it isn't one of ours. */
export function upstreamFor(lists: ServerList[], id: string, path: string, query: URLSearchParams): Upstream | null {
  const list = lists.find((l) => l.id === id);
  if (!list) return null;
  if (path === "player_api.php") {
    const params = new URLSearchParams(query);
    params.set("username", list.username);
    params.set("password", list.password);
    return { kind: "api", url: new URL(`${list.server}/player_api.php?${params}`) };
  }
  const m = /^(live|movie|series)\/-\/-\/([\w.-]+)$/.exec(path);
  if (!m) return null;
  const login = `${encodeURIComponent(list.username)}/${encodeURIComponent(list.password)}`;
  return { kind: "stream", url: new URL(`${list.server}/${m[1]}/${login}/${m[2]}`), live: m[1] === "live" };
}

/** The panel echoes the login back (user_info.username / password): it never leaves the server. */
export function scrubLogin(text: string, list: ServerList): string {
  let out = text.split(list.password).join(PLACEHOLDER);
  if (list.username.length > 2) out = out.split(list.username).join(PLACEHOLDER);
  return out;
}
