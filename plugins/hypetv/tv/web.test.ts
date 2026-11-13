import { expect, test } from "bun:test";
import { physical, transformFor, tvCss, unwrapSelector, words } from "./web";

test("TV CSS: selectors old Chromium understands", () => {
  expect(unwrapSelector(":is(:where(.group\/tile):focus .x\:y):not(#\#)")).toBe(".group\/tile:focus .x\:y:not(#\#)");
  expect(unwrapSelector("abbr:where([title])")).toBe("abbr[title]");
  expect(unwrapSelector(":where(.space-y-2>:not(:last-child))")).toBe(".space-y-2>:not(:last-child)");
  // A list stays (Lightning CSS turns simple ones into :-webkit-any); a complex :is() mid-compound stays.
  expect(unwrapSelector("select:is([multiple],[size])")).toBe("select:is([multiple],[size])");
  expect(unwrapSelector(".a:is(.b .c)")).toBe(".a:is(.b .c)");
});

test("TV CSS: logical properties, transforms, values", () => {
  expect(words("calc(var(--a) * 2) var(--b)")).toEqual(["calc(var(--a) * 2)", "var(--b)"]);
  expect(physical("padding-inline", "calc(var(--spacing) * 4)")).toEqual([["padding-left", "calc(var(--spacing) * 4)"], ["padding-right", "calc(var(--spacing) * 4)"]]);
  expect(physical("margin-block", "1px 2px")).toEqual([["margin-top", "1px"], ["margin-bottom", "2px"]]);
  expect(physical("inset-inline", "0")).toEqual([["left", "0"], ["right", "0"]]);
  expect(physical("inset", "1px 2px")).toEqual([["top", "1px"], ["right", "2px"], ["bottom", "1px"], ["left", "2px"]]);
  expect(physical("border-inline-start-width", "2px")).toEqual([["border-left-width", "2px"]]);
  expect(physical("color", "red")).toBeNull();
  expect(transformFor("translate", "var(--x) var(--y)")).toBe("translate(var(--x), var(--y))");
  expect(transformFor("scale", "1.03")).toBe("scale(1.03, 1.03)");
});

test("TV CSS: a whole Tailwind-like sheet", async () => {
  const out = await tvCss(`.px-4{padding-inline:calc(var(--spacing)*4)}.a:focus-visible{outline:2px solid red}.t{--tw-scale-x:110%;translate:var(--x) var(--y)}.v{aspect-ratio:16/9}`);
  expect(out).not.toContain("padding-inline");
  expect(out).not.toContain("focus-visible");
  expect(out).toContain("padding-left");
  expect(out).toContain("--tw-scale-x:1.1");
  expect(out).toContain("transform:var(--tv-translate)");
  expect(out).toMatch(/@supports not \(aspect-ratio:\s?1\s?\/\s?1\)/);
});
