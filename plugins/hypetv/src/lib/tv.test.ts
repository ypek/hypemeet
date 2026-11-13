import { expect, test } from "bun:test";
import { nextInDirection } from "./tv";

const rect = (x: number, y: number, w = 100, h = 100) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y }) as DOMRect;
const el = (name: string) => ({ name }) as unknown as HTMLElement;

test("spatial navigation: a grid moves cell by cell, a list row by row", () => {
  // 3×2 grid of cards, 100 px with 20 px gaps.
  const cells = [0, 1, 2].flatMap((col) => [0, 1].map((row) => ({ el: el(`${row},${col}`), rect: rect(col * 120, row * 120) })));
  const at = (row: number, col: number) => rect(col * 120, row * 120);
  const name = (x: HTMLElement | null) => (x as unknown as { name: string } | null)?.name;
  expect(name(nextInDirection(at(0, 0), "ArrowRight", cells))).toBe("0,1");
  expect(name(nextInDirection(at(0, 1), "ArrowDown", cells))).toBe("1,1");
  expect(name(nextInDirection(at(1, 2), "ArrowLeft", cells))).toBe("1,1");
  expect(name(nextInDirection(at(1, 0), "ArrowUp", cells))).toBe("0,0");
  expect(nextInDirection(at(0, 2), "ArrowRight", cells)).toBeNull();
  // A wide sidebar item to the left of a grid row still goes to the row's first cell.
  const sidebar = [{ el: el("side"), rect: rect(-300, 130, 250, 40) }];
  expect(name(nextInDirection(at(1, 0), "ArrowLeft", [...cells, ...sidebar]))).toBe("side");
  // Straight down beats a closer item far to the side.
  const list = [
    { el: el("below"), rect: rect(0, 400) },
    { el: el("side-near"), rect: rect(600, 130) },
  ];
  expect(name(nextInDirection(rect(0, 0), "ArrowDown", list))).toBe("below");
});

test("TV zoom: a 1920 screen shows the 1280 layout, sharp; smaller screens stay as they are", async () => {
  const { zoomFor } = await import("./tv");
  expect(zoomFor(1920)).toBe(1.5);
  expect(zoomFor(3840)).toBe(3);
  expect(zoomFor(1280)).toBeNull();
  expect(zoomFor(960)).toBeNull();
});
