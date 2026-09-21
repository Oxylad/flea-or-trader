import { describe, expect, test } from "bun:test";
import { defaultWindows, gridWindows, splitCellRects } from "../lib/scan/cells";
import type { ScanRect } from "../lib/scan/types";

const PITCH = 63;

/** A block of 1x1 cells, `columns` by `rows`, starting at (x, y). */
function block(x: number, y: number, columns: number, rows: number, skip: Array<[number, number]> = []): ScanRect[] {
  const cells: ScanRect[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (skip.some(([si, sj]) => si === i && sj === j)) continue;
      cells.push({ x: x + i * PITCH, y: y + j * PITCH, width: PITCH + 1, height: PITCH + 1, slotsWide: 1, slotsHigh: 1 });
    }
  }
  return cells;
}

describe("gridWindows", () => {
  test("separates a case window from the stash beside it", () => {
    const caseCells = block(515, 110, 14, 14);
    const stash = block(1517, 79, 6, 10);
    const windows = gridWindows([...stash, ...caseCells], PITCH);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ slotsWide: 14, slotsHigh: 14 });
    expect(windows[1]).toMatchObject({ slotsWide: 6, slotsHigh: 10 });
    expect([...defaultWindows(windows, PITCH)]).toEqual([0]);
  });

  test("keeps a thinly filled case together", () => {
    // Items with one empty (undetected) slot between them.
    const left = block(500, 100, 3, 8);
    const right = block(500 + 4 * PITCH, 100, 4, 3);
    const stash = block(1500, 100, 4, 4);
    const windows = gridWindows([...left, ...right, ...stash], PITCH);
    expect(windows).toHaveLength(3);
    const counted = defaultWindows(windows, PITCH);
    const countedSlots = [...counted].reduce((sum, i) => sum + windows[i].cells.length, 0);
    expect(countedSlots).toBe(24 + 12);
  });

  test("no cells, no windows", () => {
    expect(gridWindows([], PITCH)).toEqual([]);
    expect(defaultWindows([], PITCH).size).toBe(0);
  });
});

describe("splitCellRects", () => {
  const cell = { x: 100, y: 100, width: 127, height: 64, slotsWide: 2, slotsHigh: 1, empty: false, confidence: "low" as const, matches: [] };

  test("side by side", () => {
    const rects = splitCellRects(cell, "columns", 2);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 100, slotsWide: 1 });
    expect(rects[1].x + rects[1].width).toBe(cell.x + cell.width);
  });
});
