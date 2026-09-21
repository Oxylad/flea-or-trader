// Market data shapes shared by the server (built from Tarkov.dev) and the client.

export type GameMode = "pve" | "regular";

export const GAME_MODES: readonly GameMode[] = ["pve", "regular"];

export interface TraderOffer {
  trader: string;
  priceRUB: number;
}

export interface MarketItem {
  id: string;
  name: string;
  shortName: string;
  basePrice: number;
  width: number;
  height: number;
  iconLink: string | null;
  link: string | null;
  /** Cheapest offer currently listed. */
  lastLowPrice: number | null;
  avg24hPrice: number | null;
  lastOfferCount: number;
  /** The flea market does not accept this item. */
  noFlea: boolean;
  /** Player level the flea market needs to list this item, when it is higher than usual. */
  minFleaLevel: number | null;
  /** What traders pay, highest first. */
  traders: TraderOffer[];
}

export interface Trader {
  id: string;
  name: string;
  imageLink: string | null;
}

export interface FleaRules {
  enabled: boolean;
  minPlayerLevel: number;
  sellOfferFeeRate: number;
  sellRequirementFeeRate: number;
  foundInRaidRequired: boolean;
}

export interface MarketData {
  mode: GameMode;
  fetchedAt: string;
  flea: FleaRules;
  traders: Trader[];
  items: MarketItem[];
}
