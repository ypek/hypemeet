import { expect, test } from "bun:test";
import { readKept } from "./useCatalog";

test("kept catalogue: new copies carry their date, old ones count as stale, damaged ones are ignored", () => {
  const section = { items: [], groups: [] };
  expect(readKept(JSON.stringify({ at: 123, section }))).toEqual({ at: 123, section });
  // Saved before the date was kept: shown, but fetched again.
  expect(readKept(JSON.stringify(section))).toEqual({ at: 0, section });
  expect(readKept("{not json")).toBeNull();
  expect(readKept(undefined)).toBeNull();
  expect(readKept(JSON.stringify({ hello: 1 }))).toBeNull();
});
