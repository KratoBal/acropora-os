/**
 * THE "MI LÓG KI" OF A REEFCLUB AQUARIUM (card ce6c5cc9, V3.4 S3): the customer's own latest water values against the bands approved for
 * a customer (`CUSTOMER_RANGES`, S1), and the products that may be named for a deviation (the projection of S2b). The answer is
 * RULE-BASED: no AI, no free text from a model. THE TEXTS ARE THE TEMPLATE THAT BALÁZS APPROVES ONCE (acrobot 47110); until then
 * the test ReefClub runs with these proposals behind a switch that is off by default.
 */
export type ReefClubWaterHintsState =
  /** The switch is off: nothing was computed. */
  | "OFF"
  /** Not a sea-water aquarium (or no water type): there is no approved band, so there is no advice. */
  | "NOT_AVAILABLE"
  /** Sea water, but none of the four parameters has a measurement. */
  | "NO_MEASUREMENT"
  | "OK";

/** `OK`: at least one row has products; `NONE`: no product for any deviation (the empty list is NOT a recommendation); `STALE`: the projection is too old to name any. */
export type ReefClubWaterHintsProductsState = "OK" | "NONE" | "STALE";

export type ReefClubWaterHintStatus =
  | "ALATTA"
  | "FELETTE"
  | "TARTOMANYBAN"
  /** The last measurement of this parameter is older than its limit: no judgement is made from it. */
  | "TUL_REGI";

export interface ReefClubWaterHintProduct {
  productId: string;
  name: string;
  category: string;
  /** The product's page in the shop, or null. */
  shopUrl: string | null;
  /** The https reference the customer gets about the product, not a dosing sentence: the maker's page, or the shop's product text (see `referenceKind`). */
  referenceUrl: string;
  /** What `referenceUrl` is: the maker's page (MAKER) or the shop's own product text (SHOP_TEXT, test ReefClub only). The page picks the link label from it. */
  referenceKind: "MAKER" | "SHOP_TEXT";
  /** "Emellett hat: foszfát (csökkenti)." or null: the product's effect on a parameter with no approved band, without advice or band. */
  sideEffectsText: string | null;
}

export interface ReefClubWaterHintRow {
  parameterCode: string;
  label: string;
  unit: string;
  /** The measured value, in the parameter's unit. */
  value: number;
  measuredAt: string;
  status: ReefClubWaterHintStatus;
  /** The approved band the comparison used; null for `TUL_REGI`. */
  range: { min: number; max: number } | null;
  /** The one sentence about this value (template). */
  text: string;
  /** Only for ALATTA and FELETTE: the products that move the parameter the right way, best first, at most five. */
  products: ReefClubWaterHintProduct[];
}

export interface ReefClubWaterHints {
  state: ReefClubWaterHintsState;
  /** Why it is not available (only for `NOT_AVAILABLE`). */
  reason?: "WATER_TYPE";
  /** The register the bands came from (`CUSTOMER_RANGES_VERSION`). */
  registerVersion: string;
  /** The disclaimer the panel prints with the rows; null when there are no rows. */
  disclaimer: string | null;
  productsState: ReefClubWaterHintsProductsState;
  rows: ReefClubWaterHintRow[];
}
