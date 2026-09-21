import { useEffect, useRef, useState } from "react";
import type { CellKey, DisplayCell, GridWindow } from "../../lib/scan/cells";
import type { ScanImageResult } from "../../lib/scan/types";

/** What a cell's box says about it. */
export type CellState = "flea" | "trader" | "none" | "unrecognised" | "dismissed";

interface ScreenshotProps {
  url: string;
  result: ScanImageResult;
  cells: DisplayCell[];
  windows: GridWindow[];
  windowOf: (key: CellKey) => number;
  counted: ReadonlySet<number>;
  stateOf: (key: CellKey) => CellState | null;
  activeCell: CellKey | null;
  highlighted: ReadonlySet<CellKey>;
  onSelectCell: (key: CellKey) => void;
  onToggleWindow: (index: number) => void;
  /** The item in a box on Tarkov.dev, when it is recognised. */
  itemLink: (key: CellKey) => ItemLink | null;
  /** Fit the image to the window instead of to the column. */
  full?: boolean;
}

/** Where an item is described on Tarkov.dev. */
export interface ItemLink {
  href: string;
  name: string;
}

/** Long enough to move the pointer off a box and onto its link. */
const LINK_LINGER_MS = 150;

const LAYER: Record<CellState, number> = { dismissed: 0, none: 1, trader: 1, flea: 1, unrecognised: 2 };

export function Screenshot({
  url,
  result,
  cells,
  windows,
  windowOf,
  counted,
  stateOf,
  activeCell,
  highlighted,
  onSelectCell,
  onToggleWindow,
  itemLink,
  full = false,
}: ScreenshotProps) {
  // The box the pointer (or keyboard) is on, which shows its Tarkov.dev link.
  const [hovered, setHovered] = useState<CellKey | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLink = (key: CellKey) => {
    if (linger.current) clearTimeout(linger.current);
    setHovered(key);
  };
  // Leaving the box does not hide the link straight away, so it can be clicked.
  const hideLink = () => {
    if (linger.current) clearTimeout(linger.current);
    linger.current = setTimeout(() => setHovered(null), LINK_LINGER_MS);
  };
  useEffect(() => () => void (linger.current && clearTimeout(linger.current)), []);

  const shown = cells
    .filter((cell) => counted.has(windowOf(cell.key)))
    .map((cell) => ({ cell, state: stateOf(cell.key) }))
    .filter((entry): entry is { cell: DisplayCell; state: CellState } => entry.state !== null)
    // Boxes that need attention last, so neighbours never cover them.
    .sort(
      (a, b) =>
        LAYER[a.state] + (a.cell.key === activeCell ? 5 : 0) - (LAYER[b.state] + (b.cell.key === activeCell ? 5 : 0)),
    );

  const hoveredCell = shown.find((entry) => entry.cell.key === hovered)?.cell;
  const hoveredLink = hoveredCell && itemLink(hoveredCell.key);

  return (
    <div className={`shot ${full ? "shot--full" : ""}`}>
      <img src={url} alt="Your screenshot" className="shot__image" />
      <svg
        viewBox={`0 0 ${result.width} ${result.height}`}
        preserveAspectRatio="none"
        className="shot__overlay"
      >
        {windows.map((window, index) =>
          counted.has(index) ? null : (
            <g
              key={`window-${index}`}
              role="button"
              tabIndex={0}
              aria-label={`Count the ${window.slotsWide} by ${window.slotsHigh} grid too`}
              className="shot__window"
              onClick={() => onToggleWindow(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onToggleWindow(index);
              }}
            >
              <title>Not counted. Click to count this grid.</title>
              <rect
                x={window.x}
                y={window.y}
                width={window.width}
                height={window.height}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ),
        )}
        {shown.map(({ cell, state }) => {
          const active = cell.key === activeCell;
          return (
            <g
              key={cell.key}
              role="button"
              tabIndex={0}
              aria-label={cell.matches[0]?.shortName ?? "Unrecognised item"}
              className={`cell cell--${state} ${active ? "cell--active" : ""} ${
                highlighted.has(cell.key) ? "cell--highlighted" : ""
              } ${cell.confidence !== "high" && state !== "unrecognised" ? "cell--unsure" : ""}`}
              onClick={() => onSelectCell(cell.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectCell(cell.key);
              }}
              onMouseEnter={() => showLink(cell.key)}
              onMouseLeave={hideLink}
              onFocus={() => showLink(cell.key)}
              onBlur={hideLink}
            >
              <rect
                x={cell.x + 2}
                y={cell.y + 2}
                width={Math.max(1, cell.width - 4)}
                height={Math.max(1, cell.height - 4)}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>
      {hoveredCell && hoveredLink && (
        <a
          className="linkout shot__link"
          // The top right corner of the box, inside it.
          style={{
            left: `${((hoveredCell.x + hoveredCell.width) / result.width) * 100}%`,
            top: `${(hoveredCell.y / result.height) * 100}%`,
          }}
          href={hoveredLink.href}
          target="_blank"
          rel="noopener noreferrer"
          title="Tarkov.dev"
          aria-label={`Open ${hoveredLink.name} on Tarkov.dev`}
          onMouseEnter={() => showLink(hoveredCell.key)}
          onMouseLeave={hideLink}
          onFocus={() => showLink(hoveredCell.key)}
          onBlur={hideLink}
        >
          <span aria-hidden>↗</span>
        </a>
      )}
    </div>
  );
}

interface CellPreviewProps {
  url: string;
  imageWidth: number;
  imageHeight: number;
  cell: { x: number; y: number; width: number; height: number };
  size: number;
}

/** The cell's region of the screenshot, scaled to `size` px wide. */
export function CellPreview({ url, imageWidth, imageHeight, cell, size }: CellPreviewProps) {
  const scale = size / cell.width;
  return (
    <div
      aria-hidden
      className="preview"
      style={{
        width: size,
        height: cell.height * scale,
        backgroundImage: `url(${url})`,
        backgroundSize: `${imageWidth * scale}px ${imageHeight * scale}px`,
        backgroundPosition: `${-cell.x * scale}px ${-cell.y * scale}px`,
      }}
    />
  );
}
