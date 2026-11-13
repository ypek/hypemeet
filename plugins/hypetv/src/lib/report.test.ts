import { expect, test } from "bun:test";
import { describeSrc } from "./net";

test("error report: sources described without any login", () => {
  const base = new URL("https://x.discordsays.com/plugins/hypetv/api/");
  // Our server's list: its path (only "-" in it).
  expect(describeSrc("https://x.discordsays.com/plugins/hypetv/api/x/1/movie/-/-/5013346.mp4", base)).toBe("x/1/movie/-/-/5013346.mp4");
  // Through our relay: the path and the target's host, never the target's path (it carries the login).
  expect(describeSrc("https://x.discordsays.com/plugins/hypetv/api/stream?u=http%3A%2F%2Fpanel.tv%2Flive%2Fuser%2Fpass%2F1.ts", base)).toBe("stream→panel.tv");
  // Anything else: just the host.
  expect(describeSrc("https://hypetv.mihawkdev.com/api/x/1/movie/-/-/1.mp4", base)).toBe("hypetv.mihawkdev.com");
  expect(describeSrc("http://panel.tv/movie/user/pass/1.mp4", base)).toBe("panel.tv");
});
