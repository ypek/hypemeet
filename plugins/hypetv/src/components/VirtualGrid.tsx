import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Width and height of an element, kept current; measures whenever the element (re)appears. */
export function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const current = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => {
    current.current = node;
    setEl(node);
  }, []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [ref, size, current] as const;
}

const OVERSCAN_ROWS = 4;

/**
 * Only the rows on screen get rendered: lists run to tens of thousands of films. One column of rows for
 * channels; posters fill as many columns of at least `minWidth` as fit.
 */
export function VirtualGrid<T>({
  items,
  minWidth,
  rowHeight,
  gap = 8,
  resetKey,
  render,
  keyOf,
  empty,
}: {
  items: T[];
  /** Columns at least this wide; 0 = a single column. */
  minWidth: number;
  /** Height of a row, given the width of a column. */
  rowHeight: (columnWidth: number) => number;
  gap?: number;
  /** Changing it scrolls back to the top (another group, another search). */
  resetKey: string;
  render: (item: T, index: number) => ReactNode;
  keyOf: (item: T) => string;
  empty?: ReactNode;
}) {
  const [ref, { width, height }, node] = useSize<HTMLDivElement>();
  const [top, setTop] = useState(0);
  useEffect(() => {
    if (node.current) node.current.scrollTop = 0;
    setTop(0);
  }, [resetKey, node]);

  const inner = Math.max(0, width - 12); // room for the scrollbar
  const columns = minWidth ? Math.max(1, Math.floor((inner + gap) / (minWidth + gap))) : 1;
  const columnWidth = columns > 1 ? (inner - gap * (columns - 1)) / columns : inner;
  const row = rowHeight(columnWidth) + gap;
  const rows = Math.ceil(items.length / columns);
  const first = Math.max(0, Math.floor(top / row) - OVERSCAN_ROWS);
  const last = Math.min(rows, Math.ceil((top + height) / row) + OVERSCAN_ROWS);

  const cells: ReactNode[] = [];
  if (width)
    for (let r = first; r < last; r++)
      for (let c = 0; c < columns; c++) {
        const index = r * columns + c;
        const item = items[index];
        if (item === undefined) break;
        cells.push(
          <div
            key={keyOf(item)}
            style={{ position: "absolute", top: r * row, left: c * (columnWidth + gap), width: columnWidth, height: row - gap }}
          >
            {render(item, index)}
          </div>,
        );
      }

  return (
    <div ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto pr-3">
      {items.length === 0 ? empty : <div style={{ position: "relative", height: rows * row }}>{cells}</div>}
    </div>
  );
}
