// Scan cells as the page works with them: split by hand, assigned to items,
// and grouped into the grid windows they belong to.

import type { ScanCell, ScanImageResult, ScanRect } from "./types";

/** "cell", or "cell#slot" for one slot of a cell the user split apart. */
export type CellKey = string;

export const cellKey = (cell: number): CellKey => String(cell);
export const splitCellKey = (parent: CellKey, slot: number): CellKey => `${parent}#${slot}`;
export const parentKey = (key: CellKey): CellKey => key.split("#")[0];

export interface DisplayCell extends ScanCell {
  key: CellKey;
}

/** How a cell is cut up: into stacked rows, side-by-side columns, or slots. */
export type SplitDirection = "rows" | "columns" | "slots";

export interface SplitOption {
  direction: SplitDirection;
  /** Number of items the cell is split into. */
  count: number;
}

const divisors = (slots: number): number[] =>
  Array.from({ length: slots }, (_, i) => i + 1).filter((n) => n > 1 && slots % n === 0);

/** The ways a multi-slot cell can be split. */
export function splitOptions(cell: Pick<ScanCell, "slotsWide" | "slotsHigh">): SplitOption[] {
  const options: SplitOption[] = [
    ...divisors(cell.slotsHigh).map((count) => ({ direction: "rows" as const, count })),
    ...divisors(cell.slotsWide).map((count) => ({ direction: "columns" as const, count })),
  ];
  const slots = cell.slotsWide * cell.slotsHigh;
  // "Every slot" only when it is not already covered by a row/column split.
  if (slots > 1 && !options.some((o) => o.count === slots)) {
    options.push({ direction: "slots", count: slots });
  }
  return options;
}

/**
 * Cuts a cell into `count` equal parts, as rectangles to re-match. A detected
 * cell includes both border lines, so the parts share the borders between them.
 */
export function splitCellRects(
  cell: ScanCell,
  direction: SplitDirection = "slots",
  count?: number,
): ScanRect[] {
  const columns =
    direction === "columns" ? (count ?? cell.slotsWide) : direction === "slots" ? cell.slotsWide : 1;
  const rows =
    direction === "rows" ? (count ?? cell.slotsHigh) : direction === "slots" ? cell.slotsHigh : 1;

  const rects: ScanRect[] = [];
  const columnAt = (i: number) => cell.x + Math.round((i * (cell.width - 1)) / columns);
  const rowAt = (j: number) => cell.y + Math.round((j * (cell.height - 1)) / rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      rects.push({
        x: columnAt(i),
        y: rowAt(j),
        width: columnAt(i + 1) - columnAt(i) + 1,
        height: rowAt(j + 1) - rowAt(j) + 1,
        slotsWide: Math.max(1, Math.round(cell.slotsWide / columns)),
        slotsHigh: Math.max(1, Math.round(cell.slotsHigh / rows)),
      });
    }
  }
  return rects;
}

/** Detected cells, with any the user split replaced by their slots. */
export function displayCells(
  result: ScanImageResult,
  splits: Record<CellKey, ScanCell[]>,
): DisplayCell[] {
  return result.cells.flatMap((cell, index) => {
    const key = cellKey(index);
    const parts = splits[key];
    if (!parts) return [{ ...cell, key }];
    return parts.map((part, slot) => ({ ...part, key: splitCellKey(key, slot) }));
  });
}

/** Item id per non-empty cell, or null when unrecognised or dismissed. */
export type CellAssignments = Record<CellKey, string | null>;

export function initialAssignments(cells: DisplayCell[]): CellAssignments {
  const assignments: CellAssignments = {};
  for (const cell of cells) {
    if (cell.empty) continue;
    const best = cell.matches[0];
    assignments[cell.key] = best && cell.confidence !== "low" ? best.itemId : null;
  }
  return assignments;
}

export interface GridWindow {
  /** Bounding box of the window's cells, in screenshot pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Size of the bounding box in inventory slots. */
  slotsWide: number;
  slotsHigh: number;
  /** Indexes of the detected cells in this window. */
  cells: number[];
}

/**
 * Splits detected cells into grid windows: cells that touch belong to the same
 * one. A screenshot of an opened case usually also shows the stash behind it.
 * Windows are ordered by their number of slots, biggest first.
 */
export function gridWindows(cells: ScanRect[], pitch: number): GridWindow[] {
  const parent = cells.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const reach = Math.max(3, Math.round(pitch * 0.2));
  const near = (a: ScanRect, b: ScanRect, gap: number) =>
    a.x - gap <= b.x + b.width &&
    b.x - gap <= a.x + a.width &&
    a.y - gap <= b.y + b.height &&
    b.y - gap <= a.y + a.height;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (near(cells[i], cells[j], reach)) parent[find(i)] = find(j);
    }
  }

  const members = new Map<number, number[]>();
  cells.forEach((_, i) => {
    const root = find(i);
    members.set(root, [...(members.get(root) ?? []), i]);
  });
  const slotCount = (indexes: number[]) =>
    indexes.reduce((sum, i) => sum + cells[i].slotsWide * cells[i].slotsHigh, 0);

  return [...members.values()]
    .sort((a, b) => slotCount(b) - slotCount(a))
    .map((indexes) => {
      const x = Math.min(...indexes.map((i) => cells[i].x));
      const y = Math.min(...indexes.map((i) => cells[i].y));
      const width = Math.max(...indexes.map((i) => cells[i].x + cells[i].width)) - x;
      const height = Math.max(...indexes.map((i) => cells[i].y + cells[i].height)) - y;
      const unit = pitch > 0 ? pitch : 64;
      return {
        x,
        y,
        width,
        height,
        slotsWide: Math.max(1, Math.round(width / unit)),
        slotsHigh: Math.max(1, Math.round(height / unit)),
        cells: indexes,
      };
    });
}

/**
 * Windows counted by default: the biggest, plus windows within one slot of it.
 * Items spread thinly through a case can leave empty slots the scan does not
 * see, which splits the case into several windows; the stash behind a case
 * window sits further away.
 */
export function defaultWindows(windows: GridWindow[], pitch: number): Set<number> {
  const chosen = new Set<number>();
  if (!windows.length) return chosen;
  chosen.add(0);
  const gap = Math.max(4, pitch * 1.1);
  let box = { ...windows[0] };
  let grew = true;
  while (grew) {
    grew = false;
    windows.forEach((window, index) => {
      if (chosen.has(index)) return;
      const close =
        window.x - gap <= box.x + box.width &&
        box.x - gap <= window.x + window.width &&
        window.y - gap <= box.y + box.height &&
        box.y - gap <= window.y + window.height;
      if (!close) return;
      chosen.add(index);
      const right = Math.max(box.x + box.width, window.x + window.width);
      const bottom = Math.max(box.y + box.height, window.y + window.height);
      box = { ...box, x: Math.min(box.x, window.x), y: Math.min(box.y, window.y) };
      box.width = right - box.x;
      box.height = bottom - box.y;
      grew = true;
    });
  }
  return chosen;
}
