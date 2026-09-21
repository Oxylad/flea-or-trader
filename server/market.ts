// Flea and trader prices per game mode, from Tarkov.dev's JSON API. Kept in
// memory, refreshed in the background, served pre-compressed.

import { JSON_API_URL } from "../lib/scan/index-builder";
import type { FleaRules, GameMode, MarketData, MarketItem, Trader } from "../lib/market";

/** Tarkov.dev refreshes flea prices every few minutes. */
const REFRESH_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30000;

interface RawItem {
  id: string;
  name: string;
  shortName: string;
  width?: number;
  height?: number;
  basePrice?: number;
  iconLink?: string;
  link?: string;
  types?: string[];
  lastLowPrice?: number | null;
  avg24hPrice?: number | null;
  lastOfferCount?: number | null;
  handbookCategories?: string[];
  sellToTrader?: Array<{ trader: string; priceRUB: number }>;
}

interface RawItemsFile {
  data: {
    items: Record<string, RawItem>;
    fleaMarket: FleaRules;
    handbookCategories: Record<string, { minLevelForFlea?: number | null }>;
  };
}

interface RawTrader {
  id: string;
  name: string;
  imageLink?: string;
}

export interface MarketPayload {
  data: MarketData;
  json: Uint8Array<ArrayBuffer>;
  gzip: Uint8Array<ArrayBuffer>;
  etag: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${JSON_API_URL}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} (${path})`);
  return (await response.json()) as T;
}

async function fetchMarket(mode: GameMode): Promise<MarketData> {
  const [items, itemNames, traders, traderNames] = await Promise.all([
    fetchJson<RawItemsFile>(`/${mode}/items`),
    fetchJson<{ data: Record<string, string> }>(`/${mode}/items_en`),
    fetchJson<{ data: Record<string, RawTrader> }>(`/${mode}/traders`),
    fetchJson<{ data: Record<string, string> }>(`/${mode}/traders_en`),
  ]);
  const { fleaMarket, handbookCategories } = items.data;

  const marketItems: MarketItem[] = [];
  for (const raw of Object.values(items.data.items)) {
    const types = raw.types ?? [];
    if (types.includes("preset")) continue;
    const minFleaLevel = Math.max(
      0,
      ...(raw.handbookCategories ?? []).map((id) => handbookCategories[id]?.minLevelForFlea ?? 0),
    );
    marketItems.push({
      id: raw.id,
      name: itemNames.data[raw.name] ?? raw.name,
      shortName: itemNames.data[raw.shortName] ?? raw.shortName,
      basePrice: raw.basePrice ?? 0,
      width: raw.width ?? 1,
      height: raw.height ?? 1,
      iconLink: raw.iconLink ?? null,
      link: raw.link ?? null,
      lastLowPrice: raw.lastLowPrice || null,
      avg24hPrice: raw.avg24hPrice || null,
      lastOfferCount: raw.lastOfferCount ?? 0,
      noFlea: types.includes("noFlea"),
      minFleaLevel: minFleaLevel > fleaMarket.minPlayerLevel ? minFleaLevel : null,
      traders: (raw.sellToTrader ?? [])
        .filter((offer) => offer.priceRUB > 0)
        .map((offer) => ({ trader: offer.trader, priceRUB: offer.priceRUB }))
        .sort((a, b) => b.priceRUB - a.priceRUB),
    });
  }
  marketItems.sort((a, b) => a.name.localeCompare(b.name));

  const marketTraders: Trader[] = Object.values(traders.data).map((trader) => ({
    id: trader.id,
    name: traderNames.data[trader.name] ?? trader.name,
    imageLink: trader.imageLink ?? null,
  }));

  return {
    mode,
    fetchedAt: new Date().toISOString(),
    flea: {
      enabled: fleaMarket.enabled,
      minPlayerLevel: fleaMarket.minPlayerLevel,
      sellOfferFeeRate: fleaMarket.sellOfferFeeRate,
      sellRequirementFeeRate: fleaMarket.sellRequirementFeeRate,
      foundInRaidRequired: fleaMarket.foundInRaidRequired,
    },
    traders: marketTraders,
    items: marketItems,
  };
}

function toPayload(data: MarketData): MarketPayload {
  const json = new TextEncoder().encode(JSON.stringify(data)) as Uint8Array<ArrayBuffer>;
  return {
    data,
    json,
    gzip: Bun.gzipSync(json) as Uint8Array<ArrayBuffer>,
    etag: `"${Bun.hash(json).toString(36)}"`,
  };
}

const cache = new Map<GameMode, { payload: MarketPayload | null; refreshing: Promise<void> | null; at: number }>();

const log = (message: string) => console.log(`[market] ${message}`);

function refresh(mode: GameMode): Promise<void> {
  const entry = cache.get(mode) ?? { payload: null, refreshing: null, at: 0 };
  cache.set(mode, entry);
  entry.refreshing ??= fetchMarket(mode)
    .then((data) => {
      entry.payload = toPayload(data);
      entry.at = Date.now();
    })
    .catch((error) => log(`${mode} refresh failed: ${error instanceof Error ? error.message : error}`))
    .finally(() => {
      entry.refreshing = null;
    });
  return entry.refreshing;
}

/** Current prices; stale ones are served while a refresh runs. */
export async function getMarket(mode: GameMode): Promise<MarketPayload | null> {
  const entry = cache.get(mode);
  if (!entry?.payload) {
    await refresh(mode);
    return cache.get(mode)?.payload ?? null;
  }
  if (Date.now() - entry.at > REFRESH_MS) void refresh(mode);
  return entry.payload;
}

export function warmMarket(modes: readonly GameMode[]): void {
  for (const mode of modes) void refresh(mode);
  setInterval(() => modes.forEach((mode) => void refresh(mode)), REFRESH_MS).unref?.();
}
