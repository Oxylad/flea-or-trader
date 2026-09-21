import type { MarketItem, Trader } from "../../lib/market";
import type { Verdict } from "../../lib/pricing";
import { roubles } from "../util";

export interface SheetRow extends Verdict {
  item: MarketItem;
  /** Some of its boxes were matched with less than high confidence. */
  unsure: boolean;
}

interface SellSheetProps {
  rows: SheetRow[];
  traders: ReadonlyMap<string, Trader>;
  unrecognised: number;
  onReviewUnrecognised: () => void;
  onOpenItem: (itemId: string) => void;
  onHoverItem: (itemId: string | null) => void;
}

const sum = (rows: SheetRow[]) => rows.reduce((total, row) => total + row.unitValue * row.count, 0);

export function SellSheet({
  rows,
  traders,
  unrecognised,
  onReviewUnrecognised,
  onOpenItem,
  onHoverItem,
}: SellSheetProps) {
  const traderName = (id: string | undefined) => (id ? (traders.get(id)?.name ?? "Trader") : "Trader");

  const flea = rows.filter((r) => r.destination === "flea").sort((a, b) => b.fleaGain * b.count - a.fleaGain * a.count);
  const byTrader = new Map<string, SheetRow[]>();
  for (const row of rows.filter((r) => r.destination === "trader")) {
    const list = byTrader.get(row.trader!.trader) ?? [];
    list.push(row);
    byTrader.set(row.trader!.trader, list);
  }
  const traderGroups = [...byTrader.entries()]
    .map(([id, list]) => ({ id, rows: list.sort((a, b) => b.unitValue * b.count - a.unitValue * a.count) }))
    .sort((a, b) => sum(b.rows) - sum(a.rows));
  const unsellable = rows.filter((r) => r.destination === "none");

  const fleaTotal = sum(flea);
  const traderTotal = traderGroups.reduce((total, group) => total + sum(group.rows), 0);
  const total = fleaTotal + traderTotal;
  const allToTraders = rows.reduce((t, r) => t + (r.trader?.priceRUB ?? 0) * r.count, 0);
  const itemCount = rows.reduce((t, r) => t + r.count, 0);

  const row = (r: SheetRow) => {
    const other = r.destination === "flea" ? r.trader : null;
    return (
      <li key={r.itemId}>
        <button
          type="button"
          className="row"
          onClick={() => onOpenItem(r.itemId)}
          onMouseEnter={() => onHoverItem(r.itemId)}
          onMouseLeave={() => onHoverItem(null)}
          onFocus={() => onHoverItem(r.itemId)}
          onBlur={() => onHoverItem(null)}
        >
          {r.item.iconLink ? <img src={r.item.iconLink} alt="" className="row__icon" loading="lazy" /> : <span className="row__icon" />}
          <span className="row__name">
            {r.item.name}
            {r.count > 1 && <span className="row__count">×{r.count}</span>}
            {r.unsure && <span className="tag">check</span>}
            {r.destination === "flea" && r.item.minFleaLevel && (
              <span className="tag" title="Player level the flea market needs to list this item">
                level {r.item.minFleaLevel}
              </span>
            )}
          </span>
          <span className="row__value">{roubles(r.unitValue * r.count)}</span>
          <span className="row__detail">
            {r.destination === "flea" && r.listing ? (
              <>
                List at {roubles(r.listing.price)}
                {r.count > 1 ? " each" : ""}, fee {roubles(r.listing.fee)}.{" "}
                {other
                  ? `${roubles(r.fleaGain)} more than ${traderName(other.trader)}.`
                  : "No trader buys it."}
                {r.listing.loweredForFee && " Listing higher loses more to the fee."}
              </>
            ) : (
              reasonText(r)
            )}
          </span>
        </button>
        {r.item.link && (
          <a
            className="linkout row__link"
            href={r.item.link}
            target="_blank"
            rel="noopener noreferrer"
            title="Tarkov.dev"
            aria-label={`Open ${r.item.name} on Tarkov.dev`}
          >
            <span aria-hidden>↗</span>
          </a>
        )}
      </li>
    );
  };

  return (
    <section className="sheet" aria-label="Where to sell">
      <div className="ledger">
        <p className="ledger__total">{roubles(total)}</p>
        <p className="ledger__caption">
          for {itemCount} {itemCount === 1 ? "item" : "items"}
          {allToTraders < total && <>, {roubles(total - allToTraders)} more than selling everything to traders</>}
        </p>
        {total > 0 && (
          <div className="ledger__bar" aria-hidden>
            <span className="ledger__flea" style={{ flexGrow: fleaTotal }} />
            <span className="ledger__trader" style={{ flexGrow: traderTotal }} />
          </div>
        )}
        <dl className="ledger__split">
          <div>
            <dt>Flea market</dt>
            <dd>
              {roubles(fleaTotal)}
              <small>
                {flea.length} {flea.length === 1 ? "offer" : "offers"}
              </small>
            </dd>
          </div>
          <div>
            <dt>Traders</dt>
            <dd>
              {roubles(traderTotal)}
              <small>
                {traderGroups.length} {traderGroups.length === 1 ? "trader" : "traders"}
              </small>
            </dd>
          </div>
        </dl>
      </div>

      {unrecognised > 0 && (
        <button type="button" className="notice" onClick={onReviewUnrecognised}>
          {unrecognised} {unrecognised === 1 ? "box wasn't" : "boxes weren't"} recognised and{" "}
          {unrecognised === 1 ? "isn't" : "aren't"} counted. Review
        </button>
      )}

      {flea.length > 0 && (
        <div className="group group--flea">
          <h2 className="group__title">
            <span>Flea market</span>
            <span className="group__sum">{roubles(fleaTotal)}</span>
          </h2>
          <ul className="rows">{flea.map(row)}</ul>
        </div>
      )}

      {traderGroups.map((group) => {
        const trader = traders.get(group.id);
        return (
          <div className="group group--trader" key={group.id}>
            <h2 className="group__title">
              {trader?.imageLink && <img src={trader.imageLink} alt="" className="group__avatar" />}
              <span>{trader?.name ?? "Trader"}</span>
              <span className="group__sum">{roubles(sum(group.rows))}</span>
            </h2>
            <ul className="rows">{group.rows.map(row)}</ul>
          </div>
        );
      })}

      {unsellable.length > 0 && (
        <div className="group group--none">
          <h2 className="group__title">
            <span>Nobody buys these</span>
          </h2>
          <ul className="rows">{unsellable.map(row)}</ul>
        </div>
      )}

      {rows.length === 0 && unrecognised === 0 && (
        <p className="sheet__empty">No items found in the counted grid.</p>
      )}
    </section>
  );
}

export function reasonText(r: SheetRow): string {
  const fleaNet = r.listing ? roubles(r.listing.net) : null;
  switch (r.reason) {
    case "trader-pays-more":
      return `Pays more than the flea market (${fleaNet} after fee).`;
    case "gain-too-small":
      return `The flea market earns only ${roubles(r.fleaGain)} more, under your minimum.`;
    case "banned-on-flea":
      return "Can't be sold on the flea market.";
    case "no-flea-price":
      return "No flea market price right now.";
    case "flea-disabled":
      return "The flea market is off in this game mode.";
    case "nobody-buys":
      return "No trader buys it and it can't go on the flea market.";
    default:
      return "";
  }
}
