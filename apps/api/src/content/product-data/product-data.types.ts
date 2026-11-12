/**
 * THE SHAPE OF FRESH PRODUCT DATA FOR THE CONTENT AGENT (card 1cbc9579, task t54-friss-termekadat; spec
 * `exchange/otletek-2026-11-03/t5-4-friss-termekadat-spec.md`).
 *
 * TWO RULES THE TYPES CARRY, because the agent will write whatever it reads into a post:
 *
 *  1. UNKNOWN IS SAID, NEVER DEFAULTED (spec 4). A scalar that cannot be known is the string `"ismeretlen"`, a whole
 *     section that cannot be known is `{ status: "ismeretlen", reason }`. A null, a 0 or an empty list would read as
 *     "no stock", "no sale", "nothing is coming", and the agent would print it.
 *  2. A SECTION NEVER CARRIES AN INTERNAL FIELD (spec 3): no purchase price, margin, costing or supplier. The select
 *     list in the repository is the boundary; these types are the second one.
 *
 * All money is a decimal STRING (gross HUF), never a float.
 */
export const UNKNOWN = "ismeretlen" as const;
export type OrUnknown<T> = T | typeof UNKNOWN;

/** A whole section that cannot be answered. `reason` is a short code, never a sentence of internals. */
export interface UnknownSection {
  status: typeof UNKNOWN;
  reason: string;
}

export interface SaleData {
  /** `fut`: running now. `tervezett`: set, starts later. An ended sale is not reported. */
  state: "fut" | "tervezett";
  /** gross HUF, decimal string */
  price: string;
  startsAt: OrUnknown<string>;
  /**
   * The first moment the sale no longer applies. A UNAS-mirror sale may have NO end date (a standing sale price): then
   * `openEnded` is true and `endsAt` is `"ismeretlen"`; the draft must not name an end.
   */
  endsAt: OrUnknown<string>;
  openEnded: boolean;
}

/** `nincs futó akció`: the Omnibus line is not needed. Otherwise the reference price, or why there is none. */
export type OmnibusData =
  | { status: "nincs futó akció" }
  | {
      status: "ismert";
      /** the lowest price of the 30 days BEFORE the reduction began, gross HUF */
      amount: string;
      currency: string;
      reductionStart: string;
      historyBegins: string;
      /** false: the history is younger than 30 days, the line must say so (or not be written) */
      complete: boolean;
    }
  | UnknownSection;

export interface PriceData {
  status: "ismert";
  currency: OrUnknown<string>;
  /** the list price (gross HUF) */
  listPrice: OrUnknown<string>;
  /** what the shop sells it for right now: the running sale price when there is one, else the list price */
  currentPrice: string;
  sale: SaleData | null;
  omnibus: OmnibusData;
  /** the last time the price changed in our history */
  lastChangedAt: OrUnknown<string>;
  /** which side the price comes from: the UNAS mirror or the Acropora OS */
  priceSource: "UNAS tükör" | "Acropora OS";
}

export interface StockData {
  status: "ismert";
  /** units that can be sold (on hand minus reserved); `"ismeretlen"` when there is no row or it is negative */
  quantity: OrUnknown<number>;
  state: "van" | "nincs" | "nem követett" | typeof UNKNOWN;
  /**
   * `leltározott` only when a CORRECTED stock count includes the variant. Before that the zero is NOT "sold out"
   * (Balázs, memory 340: until the stocktake, a zero does not mean it ran out).
   */
  reliability: "leltározott" | "nem leltározott";
  lastCountedAt: OrUnknown<string>;
  lastUpdatedAt: OrUnknown<string>;
}

export interface ArrivalEntry {
  source: "beszerzési rendelés" | "élőállat-érkezés";
  expectedOn: OrUnknown<string>;
  quantity: OrUnknown<number>;
  state: "megrendelve" | "úton" | "megérkezett";
  preorderable: OrUnknown<boolean>;
  updatedAt: string;
}

export interface ArrivalsData {
  status: "ismert";
  /**
   * ALWAYS false, and it is on the wire on purpose: only orders we booked and live-animal arrivals entered by hand are
   * here. A supplier's pro forma that is not booked yet is not tied to a variant. An EMPTY list therefore means "none
   * recorded", never "nothing is coming".
   */
  complete: false;
  recorded: ArrivalEntry[];
}

export interface VariantData {
  sku: string;
  name: OrUnknown<string>;
  active: boolean;
  price: PriceData | UnknownSection;
  stock: StockData | UnknownSection;
  /** how the product can reach the customer; derived from the shipping profile only */
  fulfilment: "szállítással" | "csak bolti átvétel" | typeof UNKNOWN;
  arrivals: ArrivalsData | UnknownSection;
}

export interface ChannelData {
  published: OrUnknown<boolean>;
  url: OrUnknown<string>;
}

export interface ProductData {
  id: string;
  name: string;
  /** active and not archived */
  active: boolean;
  brand: OrUnknown<string>;
  categories: string[];
  livestock: boolean;
  /** `unas`: the shop that sells today; `webshop`: the new shop's own channel row */
  channels: { unas: ChannelData; webshop: ChannelData };
  variants: VariantData[];
}

export interface ProductDataResponse {
  /** when the read happened (the moment of the lookup, NOT the age of any stored value) */
  queriedAt: string;
  source: "Acropora OS";
  products: ProductData[];
  /** requested identifiers that match no product: named, never dropped silently */
  notFound: string[];
  totalMatched: number;
  /** true when more matched than `limit` allowed: the list is NOT the whole answer then */
  truncated: boolean;
}
