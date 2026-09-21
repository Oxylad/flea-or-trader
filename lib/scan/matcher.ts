// Icon index and cell matching.

import type { RgbImage } from "./grid";
import {
  cellFeatures,
  dot,
  quantise,
  rotateClockwise,
  shiftedTextScore,
  TEMPLATE_SLOT_PX,
  textHeight,
  textWidthFor,
  type CellFeatures,
  type QuantisedVector,
} from "./features";

export interface CatalogIcon {
  id: string;
  shortName: string;
  width: number;
  height: number;
  /**
   * Tarkov.dev `gridImageLink`: the item on its grid background at 63px per
   * slot, short name included. (`iconLink` is always a 64px thumbnail.)
   */
  grid: RgbImage;
}

export interface TemplateFeatures {
  artCoarse: QuantisedVector;
  artFine: QuantisedVector;
  textWidth: number;
  text: QuantisedVector;
}

export interface IconTemplate {
  itemId: string;
  shortName: string;
  rotated: boolean;
  features: TemplateFeatures;
}

export interface IconIndex {
  /** Templates keyed by `${slotsWide}x${slotsHigh}` of the cell they fill. */
  bySize: Map<string, IconTemplate[]>;
  size: number;
}

export interface CellMatch {
  itemId: string;
  shortName: string;
  rotated: boolean;
  score: number;
  artScore: number;
  textScore: number;
}

export interface CellResult {
  empty: boolean;
  /** Best candidates, most likely first. */
  matches: CellMatch[];
  /** Score gap between the best and the next distinct item, 0..1. */
  margin: number;
}

const sizeKey = (w: number, h: number) => `${w}x${h}`;

function templateFeatures(image: RgbImage, slotsWide: number, slotsHigh: number) {
  return cellFeatures(image, 0, 0, image.width, image.height, slotsWide, slotsHigh);
}

function expectedSize(slots: number): number {
  return slots * TEMPLATE_SLOT_PX + 1;
}

/** Right-aligns a text map into a different width (cropping on the left). */
function realignText(
  text: Float32Array,
  fromWidth: number,
  toWidth: number,
): Float32Array {
  const height = textHeight();
  const out = new Float32Array(toWidth * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < toWidth; x++) {
      const sx = fromWidth - toWidth + x;
      if (sx >= 0 && sx < fromWidth) out[y * toWidth + x] = text[y * fromWidth + sx];
    }
  }
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

export function createIconIndex(): IconIndex {
  return { bySize: new Map(), size: 0 };
}

export function addTemplate(
  index: IconIndex,
  slotsWide: number,
  slotsHigh: number,
  template: IconTemplate,
): void {
  const key = sizeKey(slotsWide, slotsHigh);
  const list = index.bySize.get(key) ?? [];
  list.push(template);
  index.bySize.set(key, list);
  index.size++;
}

/**
 * Adds an item's upright template and, for non-square items, its rotated
 * one. Returns false when the grid image does not have the expected size.
 */
export function addCatalogIcon(index: IconIndex, item: CatalogIcon): boolean {
  const { width: w, height: h } = item;
  if (item.grid.width !== expectedSize(w) || item.grid.height !== expectedSize(h)) {
    return false;
  }

  // Art features skip the short-name band, so the grid image serves both.
  const upright = templateFeatures(item.grid, w, h);
  addTemplate(index, w, h, {
    itemId: item.id,
    shortName: item.shortName,
    rotated: false,
    features: {
      artCoarse: quantise(upright.artCoarse),
      artFine: quantise(upright.artFine),
      textWidth: upright.textWidth,
      text: quantise(upright.text),
    },
  });

  if (w !== h) {
    // In-game, rotated items keep their short name upright in the corner.
    const rotated = templateFeatures(rotateClockwise(item.grid), h, w);
    addTemplate(index, h, w, {
      itemId: item.id,
      shortName: item.shortName,
      rotated: true,
      features: {
        artCoarse: quantise(rotated.artCoarse),
        artFine: quantise(rotated.artFine),
        textWidth: textWidthFor(h),
        text: quantise(realignText(upright.text, upright.textWidth, textWidthFor(h))),
      },
    });
  }
  return true;
}

export function buildIconIndex(icons: Iterable<CatalogIcon>): IconIndex {
  const index = createIconIndex();
  for (const item of icons) addCatalogIcon(index, item);
  return index;
}

const COARSE_KEEP = 25;
const ART_WEIGHT = 0.35;
const TEXT_WEIGHT = 0.65;
/**
 * Art counts for at least this much. Some items are drawn differently in-game
 * than in Tarkov.dev's images (keys turned diagonal, a new lanyard model), and
 * their art correlation drops to around zero; the floor lets a clear short
 * name still win.
 */
const ART_FLOOR = 0.45;
/** Horizontal/vertical text shifts searched when scoring candidates. */
const TEXT_SHIFT_X = 1;
const TEXT_SHIFT_Y = 1;

/** Below both of these a cell has no short name and flat art: empty slot. */
const EMPTY_TEXT_INK = 0.01;
const EMPTY_ART_CONTRAST = 12;

/**
 * The game cuts short names that do not fit ("Shestyorka" shows as
 * "Shestyork"), right-aligned, while Tarkov.dev renders them in full. Names
 * whose text starts within this many columns of the band's left edge get
 * truncated variants: the last few columns dropped, the rest right-aligned,
 * plus enlarged variants for names Tarkov.dev shrank to fit.
 */
const TRUNCATION_LEFT_COLUMNS = 3;
/** Columns dropped per variant; the ±1 shift search fills the gaps. */
const TRUNCATION_STEPS = [4, 7, 10, 13, 16, 19, 22, 25];
/**
 * Tarkov.dev shrinks the font of names that do not fit ("Interchange"), while
 * the game keeps full-size letters and cuts the name off ("Interchan"). These
 * variants enlarge the template text around its first letter and baseline.
 */
const SHRUNK_TEXT_SCALES = [1.1, 1.2, 1.3, 1.45];
/** Truncated variants are only tried for candidates whose art is this close to the best. */
const TRUNCATION_ART_MARGIN = 0.15;
/** Ink threshold, relative to the brightest text value, for finding where text starts. */
const INK_FRACTION = 0.35;

const truncatedTexts = new WeakMap<IconTemplate, QuantisedVector[]>();

/** Column of the first text ink in a text map, or `width` when there is none. */
function firstInkColumn(values: ArrayLike<number>, width: number): number {
  const height = textHeight();
  let max = 0;
  for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]);
  if (max <= 0) return width;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (values[y * width + x] > INK_FRACTION * max) return x;
    }
  }
  return width;
}

/** Lowest row holding text ink: the baseline the game and Tarkov.dev share. */
function lastInkRow(values: ArrayLike<number>, width: number): number {
  const height = textHeight();
  let max = 0;
  for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (values[y * width + x] > INK_FRACTION * max) return y;
    }
  }
  return height - 1;
}

/** Template text enlarged by `factor` around (anchorX, anchorY), cropped to the band. */
function scaledText(
  text: QuantisedVector,
  width: number,
  factor: number,
  anchorX: number,
  anchorY: number,
): QuantisedVector | null {
  const height = textHeight();
  const out = new Float32Array(width * height);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : text.values[y * width + x] * text.scale;
  let norm = 0;
  for (let y = 0; y < height; y++) {
    const sy = anchorY + (y - anchorY) / factor;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = anchorX + (x - anchorX) / factor;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const value =
        at(x0, y0) * (1 - fx) * (1 - fy) +
        at(x0 + 1, y0) * fx * (1 - fy) +
        at(x0, y0 + 1) * (1 - fx) * fy +
        at(x0 + 1, y0 + 1) * fx * fy;
      out[y * width + x] = value;
      norm += value * value;
    }
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return quantise(out);
}

/** Truncated text variants of a template whose name may not fit in-game; empty otherwise. */
// Variants are quantised like the templates: mixing Float32 and Int8 arrays in
// shiftedTextScore's inner loop made every text comparison about twice as slow.
function truncatedVariants(template: IconTemplate): QuantisedVector[] {
  const cached = truncatedTexts.get(template);
  if (cached) return cached;

  const { text, textWidth: width } = template.features;
  const variants: QuantisedVector[] = [];
  if (firstInkColumn(text.values, width) <= TRUNCATION_LEFT_COLUMNS) {
    const height = textHeight();
    for (const dropped of TRUNCATION_STEPS) {
      const variant = new Float32Array(width * height);
      let norm = 0;
      for (let y = 0; y < height; y++) {
        for (let x = dropped; x < width; x++) {
          const value = text.values[y * width + x - dropped] * text.scale;
          variant[y * width + x] = value;
          norm += value * value;
        }
      }
      norm = Math.sqrt(norm);
      if (norm === 0) continue;
      for (let i = 0; i < variant.length; i++) variant[i] /= norm;
      variants.push(quantise(variant));
    }
    const first = firstInkColumn(text.values, width);
    const baseline = lastInkRow(text.values, width);
    for (const factor of SHRUNK_TEXT_SCALES) {
      const variant = scaledText(text, width, factor, first, baseline);
      if (variant) variants.push(variant);
    }
  }
  truncatedTexts.set(template, variants);
  return variants;
}

export function matchCell(features: CellFeatures, index: IconIndex): CellResult {
  const templates =
    index.bySize.get(sizeKey(features.slotsWide, features.slotsHigh)) ?? [];

  if (features.textInk < EMPTY_TEXT_INK && features.artContrast < EMPTY_ART_CONTRAST) {
    return { empty: true, matches: [], margin: 0 };
  }

  // Shortlist by art and by text separately: either can be unreliable on its
  // own (a re-rendered icon, a name partly hidden by artwork), and a combined
  // coarse score would drop the right item whenever one of them is.
  const byArt = templates
    .map((template) => ({ template, score: dot(features.artCoarse, template.features.artCoarse) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, COARSE_KEEP);
  const byText = templates
    .map((template) => ({ template, score: dot(features.text, template.features.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, COARSE_KEEP);
  const coarse = [...new Set([...byArt, ...byText].map((c) => c.template))];

  const scored = coarse.map((template) => ({
    template,
    artScore: dot(features.artFine, template.features.artFine),
    textScore: shiftedTextScore(
      features.text,
      features.textWidth,
      template.features.text,
      template.features.textWidth,
      TEXT_SHIFT_X,
      TEXT_SHIFT_Y,
    ),
  }));

  // A truncated in-game name only matches a shortened template, and the art
  // of a long-named item is still intact, so only near-best art is checked.
  const bestArt = Math.max(-1, ...scored.map((s) => s.artScore));
  for (const entry of scored) {
    if (entry.artScore < bestArt - TRUNCATION_ART_MARGIN) continue;
    for (const variant of truncatedVariants(entry.template)) {
      entry.textScore = Math.max(
        entry.textScore,
        shiftedTextScore(
          features.text,
          features.textWidth,
          variant,
          entry.template.features.textWidth,
          TEXT_SHIFT_X,
          TEXT_SHIFT_Y,
        ),
      );
    }
  }

  const matches: CellMatch[] = scored
    .map(({ template, artScore, textScore }) => ({
      itemId: template.itemId,
      shortName: template.shortName,
      rotated: template.rotated,
      artScore,
      textScore,
      score: ART_WEIGHT * Math.max(ART_FLOOR, artScore) + TEXT_WEIGHT * textScore,
    }))
    .sort((a, b) => b.score - a.score);

  const best = matches[0];
  const runnerUp = matches.find((m) => best && m.itemId !== best.itemId);
  const margin = best && runnerUp ? best.score - runnerUp.score : best ? best.score : 0;
  return { empty: false, matches: matches.slice(0, 5), margin };
}
