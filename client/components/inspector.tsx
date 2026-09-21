import { useMemo, useState } from "react";
import { splitOptions, type DisplayCell, type SplitDirection } from "../../lib/scan/cells";
import type { MarketItem, Trader } from "../../lib/market";
import { roubles } from "../util";
import { CellPreview } from "./screenshot";
import { reasonText, type SheetRow } from "./sell-sheet";

interface InspectorProps {
  url: string;
  imageWidth: number;
  imageHeight: number;
  cell: DisplayCell;
  assignedItemId: string | null;
  dismissed: boolean;
  itemsById: ReadonlyMap<string, MarketItem>;
  items: MarketItem[];
  /** Where the assigned item is sold, when the cell counts towards the case. */
  verdict?: SheetRow;
  traders: ReadonlyMap<string, Trader>;
  /** Absent when the cell is one slot, or already a slot of a split cell. */
  onSplit?: (direction: SplitDirection, count: number) => void;
  splitting: boolean;
  onUndoSplit?: () => void;
  onAssign: (itemId: string | null) => void;
  onClose: () => void;
  /** Tighter, for the side of the fullscreen screenshot. */
  compact?: boolean;
}

const SEARCH_LIMIT = 20;

export function Inspector({
  url,
  imageWidth,
  imageHeight,
  cell,
  assignedItemId,
  dismissed,
  itemsById,
  items,
  verdict,
  traders,
  onSplit,
  splitting,
  onUndoSplit,
  onAssign,
  onClose,
  compact = false,
}: InspectorProps) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return items
      .filter(
        (item) => item.name.toLowerCase().includes(needle) || item.shortName.toLowerCase().includes(needle),
      )
      .slice(0, SEARCH_LIMIT);
  }, [items, query]);

  const assigned = assignedItemId ? itemsById.get(assignedItemId) : undefined;
  const candidates = cell.matches.filter(
    (match, index, all) => all.findIndex((m) => m.itemId === match.itemId) === index,
  );
  const options = onSplit ? splitOptions(cell) : [];

  const option = (itemId: string, detail?: string) => {
    const item = itemsById.get(itemId);
    const selected = assignedItemId === itemId;
    return (
      <li key={itemId}>
        <button
          type="button"
          className={`pick ${selected ? "pick--selected" : ""}`}
          aria-pressed={selected}
          onClick={() => onAssign(itemId)}
        >
          {item?.iconLink ? <img src={item.iconLink} alt="" className="pick__icon" /> : <span className="pick__icon" />}
          <span className="pick__name">{item?.name ?? "Item without price data"}</span>
          <span className="pick__detail">
            {detail && <span>{detail} match</span>}
            {item && item.traders[0] && <span>{roubles(item.traders[0].priceRUB)} at best trader</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section
      className={`inspector ${compact ? "inspector--compact" : ""}`}
      // Only the one in the column is scrolled to, and an id may be used once.
      id={compact ? undefined : "inspector"}
      aria-label="Correct this item"
    >
      {verdict && !dismissed && <VerdictSummary verdict={verdict} traders={traders} />}
      <header className="inspector__head">
        <CellPreview
          url={url}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          cell={cell}
          size={compact ? Math.min(84, 34 * cell.slotsWide) : Math.min(140, 56 * cell.slotsWide)}
        />
        <div className="inspector__text">
          <h2 className="inspector__title">
            {dismissed ? "Left out" : assignedItemId ? "Is this right?" : "Which item is this?"}
          </h2>
          <p className="inspector__hint">Pick the right item if the scan got it wrong.</p>
        </div>
        <div className="inspector__actions">
          {assigned?.link && (
            <a
              className="button button--small"
              href={assigned.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${assigned.name} on Tarkov.dev`}
            >
              Tarkov.dev <span aria-hidden>↗</span>
            </a>
          )}
          <button type="button" className="button button--quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {options.length > 0 && onSplit && (
        <div className="inspector__split">
          <span>{splitting ? "Splitting…" : "More than one item in this box? Split it into"}</span>
          <div className="inspector__split-options">
            {options.map((o) => (
              <button
                key={`${o.direction}-${o.count}`}
                type="button"
                className="button button--small"
                disabled={splitting}
                onClick={() => onSplit(o.direction, o.count)}
              >
                {o.direction === "rows"
                  ? `${o.count} stacked`
                  : o.direction === "columns"
                    ? `${o.count} side by side`
                    : `${o.count} single slots`}
              </button>
            ))}
          </div>
        </div>
      )}
      {onUndoSplit && (
        <button type="button" className="button button--wide" onClick={onUndoSplit}>
          Undo the split, this is one item
        </button>
      )}

      {candidates.length > 0 && (
        <>
          <h3 className="inspector__subtitle">Closest matches</h3>
          <ul className="picks">
            {candidates.map((match) => option(match.itemId, `${Math.round(match.score * 100)}%`))}
          </ul>
        </>
      )}

      <label className="search">
        <span className="visually-hidden">Search all items</span>
        <input
          type="search"
          value={query}
          placeholder="Search all items"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {results.length > 0 && <ul className="picks">{results.map((item) => option(item.id))}</ul>}

      <button type="button" className="button button--wide" onClick={() => onAssign(null)}>
        Not an item, leave it out
      </button>
    </section>
  );
}

/** Where the item in this box goes, and how the flea market and traders compare. */
function VerdictSummary({ verdict: v, traders }: { verdict: SheetRow; traders: ReadonlyMap<string, Trader> }) {
  const traderName = v.trader ? (traders.get(v.trader.trader)?.name ?? "Trader") : null;
  const where =
    v.destination === "flea"
      ? "Sell on the flea market"
      : v.destination === "trader"
        ? `Sell to ${traderName}`
        : "Nobody buys this";
  const perItem = v.count > 1 ? " each" : "";
  // Positive: the flea market earns more per item than the best trader.
  const difference = v.listing && v.trader ? v.listing.net - v.trader.priceRUB : null;

  return (
    <div className={`verdict verdict--${v.destination}`}>
      <div className="verdict__head">
        <p className="verdict__where">{where}</p>
        <p className="verdict__value">
          {roubles(v.unitValue)}
          {perItem}
          {v.count > 1 && <small>{roubles(v.unitValue * v.count)} for {v.count}</small>}
        </p>
      </div>
      <dl className="verdict__compare">
        <div>
          <dt>Flea market</dt>
          <dd>
            {v.listing ? (
              <>
                {roubles(v.listing.net)} after fee
                <small>
                  List at {roubles(v.listing.price)}, fee {roubles(v.listing.fee)}
                </small>
              </>
            ) : (
              "Can't sell"
            )}
          </dd>
        </div>
        <div>
          <dt>{traderName ?? "Traders"}</dt>
          <dd>{v.trader ? roubles(v.trader.priceRUB) : "No trader buys it"}</dd>
        </div>
        {difference !== null && (
          <div>
            <dt>Difference</dt>
            <dd>
              {difference >= 0
                ? `Flea market +${roubles(difference)}`
                : `${traderName} +${roubles(-difference)}`}
              {perItem && <small>per item</small>}
            </dd>
          </div>
        )}
      </dl>
      {v.destination !== "flea" && <p className="verdict__reason">{reasonText(v)}</p>}
      {v.destination === "flea" && v.listing?.loweredForFee && (
        <p className="verdict__reason">Listing higher loses more to the fee.</p>
      )}
    </div>
  );
}
