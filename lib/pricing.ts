// Where each item earns more: the flea market after its listing fee, or the
// best trader.

import type { FleaRules, MarketItem, TraderOffer } from "./market";

export type FleaPriceBasis = "lastLowPrice" | "avg24hPrice";

export interface SellSettings {
  fleaPriceBasis: FleaPriceBasis;
  /** List this many percent under the basis price, to sell faster. */
  undercutPercent: number;
  intelCenterLevel3: boolean;
  /** Hideout management skill level, 0-51. Only counts with Intel Center level 3. */
  hideoutManagementLevel: number;
  /** Use the flea market only when it earns at least this much more per item. */
  minFleaGain: number;
}

export const DEFAULT_SELL_SETTINGS: SellSettings = {
  fleaPriceBasis: "lastLowPrice",
  undercutPercent: 0,
  intelCenterLevel3: false,
  hideoutManagementLevel: 0,
  minFleaGain: 5000,
};

/**
 * Flea market listing fee for one item, as the game computes it. Mirrors
 * Tarkov.dev's `fleaMarketFee` resolver.
 */
export function fleaFee(
  basePrice: number,
  price: number,
  flea: Pick<FleaRules, "sellOfferFeeRate" | "sellRequirementFeeRate">,
  settings: Pick<SellSettings, "intelCenterLevel3" | "hideoutManagementLevel">,
): number {
  const vo = Math.max(1, basePrice);
  const vr = Math.max(1, price);
  let po = Math.log10(vo / vr);
  if (vr < vo) po = Math.pow(po, 1.08);
  let pr = Math.log10(vr / vo);
  if (vr >= vo) pr = Math.pow(pr, 1.08);
  let fee =
    vo * flea.sellOfferFeeRate * Math.pow(4, po) + vr * flea.sellRequirementFeeRate * Math.pow(4, pr);
  if (settings.intelCenterLevel3) {
    const management = Math.min(51, Math.max(0, settings.hideoutManagementLevel));
    fee -= fee * (0.3 + 0.3 * management * 0.01);
  }
  return Math.round(Math.min(fee, Number.MAX_SAFE_INTEGER));
}

export interface Listing {
  /** Price to list one item at. */
  price: number;
  fee: number;
  /** What one sale brings in after the fee. */
  net: number;
  /** The fee grows faster than the price, so listing lower earns more. */
  loweredForFee: boolean;
}

const PRICE_SAMPLES = 96;

/**
 * The best listing at or under the market price. Far above an item's base
 * price the fee outgrows the price, so the best price can be below market.
 */
export function bestListing(
  item: MarketItem,
  flea: FleaRules,
  settings: SellSettings,
): Listing | null {
  const market = item[settings.fleaPriceBasis] ?? item.lastLowPrice ?? item.avg24hPrice;
  if (!market || market <= 0) return null;
  const ceiling = Math.max(1, Math.floor(market * (1 - settings.undercutPercent / 100)));

  const listingAt = (price: number) => {
    const fee = fleaFee(item.basePrice, price, flea, settings);
    return { price, fee, net: price - fee };
  };

  let best = listingAt(ceiling);
  // Net income is unimodal in price; sample downwards geometrically.
  const floor = Math.max(1, ceiling / 100);
  for (let i = 1; i <= PRICE_SAMPLES; i++) {
    const price = Math.round(ceiling * Math.pow(floor / ceiling, i / PRICE_SAMPLES));
    const candidate = listingAt(price);
    if (candidate.net > best.net) best = candidate;
  }
  if (best.net <= 0) return null;
  return { ...best, loweredForFee: best.price < ceiling };
}

export type Destination = "flea" | "trader" | "none";

export type VerdictReason =
  | "flea-pays-more"
  | "trader-pays-more"
  | "gain-too-small"
  | "banned-on-flea"
  | "no-flea-price"
  | "flea-disabled"
  | "nobody-buys";

export interface Verdict {
  itemId: string;
  count: number;
  destination: Destination;
  reason: VerdictReason;
  listing: Listing | null;
  trader: TraderOffer | null;
  /** Per item: flea net minus the trader price (flea net when no trader buys it). */
  fleaGain: number;
  /** Per item: roubles from the chosen destination. */
  unitValue: number;
}

export interface OwnedGroup {
  itemId: string;
  count: number;
}

/** Decides where each group of identical items goes. */
export function decide(
  groups: OwnedGroup[],
  itemsById: ReadonlyMap<string, MarketItem>,
  flea: FleaRules,
  settings: SellSettings,
): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const group of groups) {
    const item = itemsById.get(group.itemId);
    if (!item) continue;
    const trader = item.traders[0] ?? null;
    const traderPrice = trader?.priceRUB ?? 0;
    const listing = flea.enabled && !item.noFlea ? bestListing(item, flea, settings) : null;
    const fleaGain = listing ? listing.net - traderPrice : 0;

    const base = { itemId: group.itemId, count: group.count, listing, trader, fleaGain };
    const toTrader = (reason: VerdictReason): Verdict =>
      trader
        ? { ...base, destination: "trader", reason, unitValue: traderPrice }
        : { ...base, destination: "none", reason: "nobody-buys", unitValue: 0 };

    if (!flea.enabled) verdicts.push(toTrader("flea-disabled"));
    else if (item.noFlea) verdicts.push(toTrader("banned-on-flea"));
    else if (!listing) verdicts.push(toTrader("no-flea-price"));
    else if (!trader) {
      verdicts.push({ ...base, destination: "flea", reason: "flea-pays-more", unitValue: listing.net });
    } else if (fleaGain <= 0) verdicts.push(toTrader("trader-pays-more"));
    else if (fleaGain < settings.minFleaGain) verdicts.push(toTrader("gain-too-small"));
    else {
      verdicts.push({ ...base, destination: "flea", reason: "flea-pays-more", unitValue: listing.net });
    }
  }
  return verdicts;
}
