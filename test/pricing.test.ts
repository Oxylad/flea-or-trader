import { describe, expect, test } from "bun:test";
import type { FleaRules, MarketItem } from "../lib/market";
import { bestListing, decide, DEFAULT_SELL_SETTINGS, fleaFee, type SellSettings } from "../lib/pricing";

const flea: FleaRules = {
  enabled: true,
  minPlayerLevel: 15,
  sellOfferFeeRate: 0.05,
  sellRequirementFeeRate: 0.05,
  foundInRaidRequired: false,
};

const noDiscount = { intelCenterLevel3: false, hideoutManagementLevel: 0 };

function item(overrides: Partial<MarketItem>): MarketItem {
  return {
    id: "item",
    name: "Item",
    shortName: "Item",
    basePrice: 10000,
    width: 1,
    height: 1,
    iconLink: null,
    link: null,
    lastLowPrice: null,
    avg24hPrice: null,
    lastOfferCount: 10,
    noFlea: false,
    minFleaLevel: null,
    traders: [],
    ...overrides,
  };
}

describe("fleaFee", () => {
  // Reference: Tarkov.dev's fleaMarketFee resolver, evaluated by hand.
  test("listing at the base price", () => {
    // po = pr = 0: 10000 * 0.05 + 10000 * 0.05
    expect(fleaFee(10000, 10000, flea, noDiscount)).toBe(1000);
  });

  test("listing above the base price", () => {
    const vo = 224600;
    const vr = 456789;
    const po = Math.log10(vo / vr);
    const pr = Math.pow(Math.log10(vr / vo), 1.08);
    const expected = Math.round(vo * 0.05 * Math.pow(4, po) + vr * 0.05 * Math.pow(4, pr));
    expect(fleaFee(vo, vr, flea, noDiscount)).toBe(expected);
  });

  test("listing below the base price", () => {
    const vo = 50000;
    const vr = 20000;
    const po = Math.pow(Math.log10(vo / vr), 1.08);
    const pr = Math.log10(vr / vo);
    const expected = Math.round(vo * 0.05 * Math.pow(4, po) + vr * 0.05 * Math.pow(4, pr));
    expect(fleaFee(vo, vr, flea, noDiscount)).toBe(expected);
  });

  test("Intel Center level 3 and Hideout Management", () => {
    expect(fleaFee(10000, 10000, flea, { intelCenterLevel3: true, hideoutManagementLevel: 0 })).toBe(700);
    // 30% plus 51% of 30%: 45.3% off.
    expect(fleaFee(10000, 10000, flea, { intelCenterLevel3: true, hideoutManagementLevel: 51 })).toBe(547);
    // The skill does nothing without the Intel Center.
    expect(fleaFee(10000, 10000, flea, { intelCenterLevel3: false, hideoutManagementLevel: 51 })).toBe(1000);
  });
});

describe("bestListing", () => {
  test("lists at the market price when the fee is modest", () => {
    const listing = bestListing(item({ basePrice: 20000, lastLowPrice: 30000 }), flea, DEFAULT_SELL_SETTINGS)!;
    expect(listing.price).toBe(30000);
    expect(listing.net).toBe(30000 - fleaFee(20000, 30000, flea, noDiscount));
    expect(listing.loweredForFee).toBe(false);
  });

  test("lists lower when the fee outgrows the price", () => {
    const expensive = item({ basePrice: 1000, lastLowPrice: 5_000_000 });
    const listing = bestListing(expensive, flea, DEFAULT_SELL_SETTINGS)!;
    expect(listing.loweredForFee).toBe(true);
    expect(listing.net).toBeGreaterThan(5_000_000 - fleaFee(1000, 5_000_000, flea, noDiscount));
  });

  test("applies the undercut and the price basis", () => {
    const settings: SellSettings = { ...DEFAULT_SELL_SETTINGS, fleaPriceBasis: "avg24hPrice", undercutPercent: 10 };
    const listing = bestListing(item({ basePrice: 20000, lastLowPrice: 30000, avg24hPrice: 40000 }), flea, settings)!;
    expect(listing.price).toBe(36000);
  });

  test("no price, no listing", () => {
    expect(bestListing(item({}), flea, DEFAULT_SELL_SETTINGS)).toBeNull();
  });
});

describe("decide", () => {
  const items = new Map<string, MarketItem>([
    ["gpu", item({ id: "gpu", basePrice: 100000, lastLowPrice: 400000, traders: [{ trader: "therapist", priceRUB: 120000 }] })],
    ["bolts", item({ id: "bolts", basePrice: 10000, lastLowPrice: 12000, traders: [{ trader: "mechanic", priceRUB: 9000 }] })],
    ["cheap", item({ id: "cheap", basePrice: 10000, lastLowPrice: 9000, traders: [{ trader: "therapist", priceRUB: 8500 }] })],
    ["banned", item({ id: "banned", noFlea: true, lastLowPrice: 90000, traders: [{ trader: "fence", priceRUB: 5000 }] })],
    ["orphan", item({ id: "orphan", basePrice: 5000, lastLowPrice: 20000 })],
    ["junk", item({ id: "junk", noFlea: true })],
    ["watch", item({ id: "watch", basePrice: 50000, lastLowPrice: 150000, traders: [{ trader: "therapist", priceRUB: 60000 }] })],
  ]);

  const run = (settings: Partial<SellSettings> = {}, rules = flea) =>
    new Map(
      decide(
        [...items.keys()].map((itemId) => ({ itemId, count: itemId === "watch" ? 3 : 1 })),
        items,
        rules,
        { ...DEFAULT_SELL_SETTINGS, ...settings },
      ).map((v) => [v.itemId, v]),
    );

  test("sorts items by where they earn more", () => {
    const verdicts = run();
    expect(verdicts.get("gpu")).toMatchObject({ destination: "flea", reason: "flea-pays-more" });
    expect(verdicts.get("bolts")).toMatchObject({ destination: "trader", reason: "gain-too-small" });
    expect(verdicts.get("cheap")).toMatchObject({ destination: "trader", reason: "trader-pays-more" });
    expect(verdicts.get("banned")).toMatchObject({ destination: "trader", reason: "banned-on-flea" });
    expect(verdicts.get("orphan")).toMatchObject({ destination: "flea", trader: null });
    expect(verdicts.get("junk")).toMatchObject({ destination: "none", reason: "nobody-buys" });
  });

  test("a zero minimum sends small gains to the flea market", () => {
    expect(run({ minFleaGain: 0 }).get("bolts")?.destination).toBe("flea");
  });

  test("every item worth listing goes to the flea market, with no offer limit", () => {
    const flea = [...run().values()].filter((v) => v.destination === "flea").map((v) => v.itemId);
    expect(flea.sort()).toEqual(["gpu", "orphan", "watch"]);
  });

  test("everything goes to traders when the flea market is off", () => {
    const verdicts = run({}, { ...flea, enabled: false });
    expect(verdicts.get("gpu")).toMatchObject({ destination: "trader", reason: "flea-disabled" });
    expect(verdicts.get("orphan")?.destination).toBe("none");
  });
});
