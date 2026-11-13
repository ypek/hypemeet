import { expect, test } from "bun:test";
import { parseLists, publicLists, scrubLogin, upstreamFor } from "./lists";

const lists = parseLists("Casa|tv.example.com:8080/|joao|s3nh4; Quebrada|::|a|b ; Outra|https://b.example/get.php|u|p");

test("lists from HYPETV_LISTS: server normalised, bad ones skipped, the page sees only id and name", () => {
  expect(lists.map((l) => [l.id, l.name, l.server])).toEqual([
    ["1", "Casa", "http://tv.example.com:8080"],
    ["3", "Outra", "https://b.example"],
  ]);
  expect(publicLists(lists)).toEqual([
    { id: "1", name: "Casa" },
    { id: "3", name: "Outra" },
  ]);
  expect(parseLists(undefined)).toEqual([]);
});

test("the login is put in on the way out", () => {
  const api = upstreamFor(lists, "1", "player_api.php", new URLSearchParams({ username: "-", password: "-", action: "get_live_streams" }));
  expect(api).toEqual({ kind: "api", url: new URL("http://tv.example.com:8080/player_api.php?username=joao&password=s3nh4&action=get_live_streams") });
  expect(upstreamFor(lists, "1", "live/-/-/123.ts", new URLSearchParams())).toEqual({ kind: "stream", url: new URL("http://tv.example.com:8080/live/joao/s3nh4/123.ts"), live: true });
  expect(upstreamFor(lists, "1", "movie/-/-/55.mkv", new URLSearchParams())).toMatchObject({ live: false });
  // Nothing else is reachable through it.
  expect(upstreamFor(lists, "1", "../admin", new URLSearchParams())).toBeNull();
  expect(upstreamFor(lists, "1", "live/x/y/1.ts", new URLSearchParams())).toBeNull();
  expect(upstreamFor(lists, "9", "player_api.php", new URLSearchParams())).toBeNull();
});

test("the panel's echo of the login never reaches the page", () => {
  const body = JSON.stringify({ user_info: { username: "joao", password: "s3nh4", auth: 1 } });
  expect(scrubLogin(body, lists[0]!)).toBe(JSON.stringify({ user_info: { username: "-", password: "-", auth: 1 } }));
});
