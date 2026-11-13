import { expect, test } from "bun:test";
import { railEdges } from "./Home";

test("rail edges: the same object back when nothing changed (or the rail re-renders forever)", () => {
  const at = (scrollLeft: number) => ({ scrollLeft, clientWidth: 500, scrollWidth: 2000 });
  const start = { start: true, end: false };
  // Measured again at the start: React must get the very same state to stop re-rendering.
  expect(railEdges(start, at(0))).toBe(start);
  // Scrolled: a new state.
  const middle = railEdges(start, at(600));
  expect(middle).toEqual({ start: false, end: false });
  expect(railEdges(middle, at(700))).toBe(middle);
  expect(railEdges(middle, at(1500))).toEqual({ start: false, end: true });
});
