// Scores recognition against hand-read labels (test/fixtures/recognition-labels.json)
// using the local icon index in .cache/scan. Usage: bun scripts/eval-recognition.ts [--verbose]

import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeRgb } from "../lib/scan/index-builder";
import { decodeIndex, indexFileName } from "../lib/scan/index-file";
import { scanImage } from "../lib/scan/scan";
import type { ScanCell } from "../lib/scan/types";

interface Window {
  x: number;
  y: number;
  rows: Array<Array<string | null>>;
}
interface Screenshot {
  file: string;
  pitch?: number;
  windows?: Window[];
  cells?: Array<{ x: number; y: number; label: string | null }>;
}

const root = path.join(import.meta.dir, "..");
const verbose = process.argv.includes("--verbose");
const fixture = JSON.parse(await readFile(path.join(root, "test/fixtures/recognition-labels.json"), "utf8")) as {
  screenshots: Screenshot[];
};
const loaded = decodeIndex(await readFile(path.join(root, ".cache/scan", indexFileName())));
if (!loaded) throw new Error("No icon index in .cache/scan; start the server once to build it.");

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function labelFor(shot: Screenshot, cell: ScanCell): string | null {
  if (shot.cells) {
    return shot.cells.find((c) => Math.abs(c.x - cell.x) <= 2 && Math.abs(c.y - cell.y) <= 2)?.label ?? null;
  }
  const pitch = shot.pitch!;
  for (const window of shot.windows ?? []) {
    const row = Math.round((cell.y - window.y) / pitch);
    const column = Math.round((cell.x - window.x) / pitch);
    const label = window.rows[row]?.[column];
    if (label !== undefined) return label;
  }
  return null;
}

let failed = false;
for (const shot of fixture.screenshots) {
  const image = await decodeRgb(await readFile(path.join(root, shot.file)));
  const started = Date.now();
  const result = await scanImage(image, loaded.index);
  const elapsed = Date.now() - started;

  const tally = { total: 0, correct: 0, highWrong: 0, mediumWrong: 0, low: 0, inTop5: 0, missed: 0 };
  const wrong: string[] = [];
  for (const cell of result.cells) {
    const label = labelFor(shot, cell);
    if (!label || cell.empty) continue;
    tally.total++;
    const matches = (name?: string) => !!name && normalise(name).startsWith(normalise(label));
    if (cell.matches.some((m) => matches(m.shortName))) tally.inTop5++;
    if (cell.confidence === "low") {
      tally.low++;
      continue;
    }
    if (matches(cell.matches[0]?.shortName)) tally.correct++;
    else {
      if (cell.confidence === "high") tally.highWrong++;
      else tally.mediumWrong++;
      wrong.push(`${label} -> ${cell.matches[0]?.shortName} (${cell.confidence})`);
    }
  }
  // Labelled slots with no detected cell at all: the grid detector dropped them.
  const missed: string[] = [];
  const pitch = shot.pitch ?? 63;
  for (const window of shot.windows ?? []) {
    window.rows.forEach((row, j) =>
      row.forEach((label, i) => {
        if (!label) return;
        const x = window.x + i * pitch;
        const y = window.y + j * pitch;
        const found = result.cells.some((c) => Math.abs(c.x - x) <= 3 && Math.abs(c.y - y) <= 3);
        if (!found) missed.push(label);
      }),
    );
  }
  for (const cell of shot.cells ?? []) {
    if (!cell.label) continue;
    if (!result.cells.some((c) => Math.abs(c.x - cell.x) <= 3 && Math.abs(c.y - cell.y) <= 3)) missed.push(cell.label);
  }
  tally.missed = missed.length;

  // Item cells that swallowed a slot labelled empty: an item and the empty slot beside it merged.
  const merged: string[] = [];
  for (const window of shot.windows ?? []) {
    for (const cell of result.cells) {
      if (cell.empty || cell.slotsWide * cell.slotsHigh === 1) continue;
      const i0 = Math.round((cell.x - window.x) / pitch);
      const j0 = Math.round((cell.y - window.y) / pitch);
      const rows = window.rows.slice(Math.max(0, j0), j0 + cell.slotsHigh);
      const slots = rows.flatMap((row) => row.slice(Math.max(0, i0), i0 + cell.slotsWide));
      if (slots.length && slots.includes(null) && slots.some((label) => label !== null)) {
        merged.push(`${slots.find((label) => label)} (${cell.slotsWide}x${cell.slotsHigh} at ${cell.x},${cell.y})`);
      }
    }
  }
  if (tally.highWrong || tally.missed || merged.length) failed = true;
  console.log(
    `${shot.file}: ${tally.correct}/${tally.total} correct, wrong high ${tally.highWrong} / medium ${tally.mediumWrong}, ` +
      `left for review ${tally.low}, right item in top 5 ${tally.inTop5}, not detected ${tally.missed}, ` +
      `merged with empty slots ${merged.length}, ${elapsed} ms`,
  );
  if (missed.length) console.log(`  not detected: ${missed.join(", ")}`);
  if (merged.length) console.log(`  merged with empty slots: ${merged.join(", ")}`);
  if (verbose && wrong.length) console.log(`  ${wrong.join("\n  ")}`);
}
// A wrong answer at high confidence is never shown for review, an undetected slot is never
// shown at all, and a merged cell hides an item's real size, so any of them fails the run.
process.exit(failed ? 1 : 0);
