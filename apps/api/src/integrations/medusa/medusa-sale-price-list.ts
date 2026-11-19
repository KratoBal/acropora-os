/**
 * THE SALE AS A MEDUSA PRICE LIST (card 54bb3779, third slice): the PLANNING, pure.
 *
 * WHY A PRICE LIST. Until now the OS sent a running sale as the variant's BASE price, so the shop knew no "original" price
 * and could not strike one through, and the sale's start and end needed an OS round to write the base price again. A
 * Medusa `sale` price list does both by itself: the variant's base price stays the REGULAR price, the list holds the sale
 * price for its window, and the shop answers `calculated_price` = the sale, `original_amount` = the regular, `price_list_type`
 * = "sale" (the storefront strikes the original through on exactly that). MEASURED on the test Medusa 2026-11-19
 * (exchange/a4-arlista-proba/futas-3.log): calculated 55680 / original 69600 / sale; the cart line takes the list price
 * without an adjustment; at `ends_at` the price returns to the regular by the clock, with no event; the OS's whole-list
 * base-price write leaves the list's row alone; deleting the list restores the base untouched.
 *
 * ONE LIST PER VARIANT SALE, FOUND BY A KEY, NOT REMEMBERED. The list's `description` is `os-sale:<medusa variant id>` and
 * nothing else uses that prefix. The OS stores nothing about the list: the shop is asked (`findSaleList`), so a list that was
 * created and then lost track of (a failed run) is found again, and a removed sale leaves nothing the OS has to remember.
 *
 * THE VARIANT'S OWN PRICES DO NOT SHOW THE LIST ROW. Measured on the same run: the variant list route the OS reads
 * (`...?fields=id,sku,deleted_at,*prices`) returns ONE row with a list in force, so the list's existence is learned from the
 * price-list query, never from the variant's prices (`baseRowsOf` is still the guard if a later Medusa brings the row in).
 */
export const SALE_LIST_KEY_PREFIX = "os-sale:";

export const saleListKey = (medusaVariantId: string): string =>
  `${SALE_LIST_KEY_PREFIX}${medusaVariantId}`;

/** What the OS wants the shop to have: the sale price, and its window (`null`: open on that side). */
export interface WantedSale {
  amount: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** A price list of ours, as the shop reports it. Dates are ISO text or `null`. */
export interface ExistingSaleList {
  id: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  /** the list's rows for ANY variant: ours holds exactly one, for the variant in the key */
  prices: {
    id: string;
    variantId: string | null;
    currencyCode: string;
    amount: number;
  }[];
}

export type SaleListPlan =
  /** nothing wanted, nothing there */
  | { kind: "none" }
  /** the list is as wanted */
  | { kind: "unchanged"; listId: string }
  | { kind: "create"; wanted: WantedSale }
  | {
      kind: "update";
      listId: string;
      /** only the fields that differ */
      list: { startsAt?: Date | null; endsAt?: Date | null; status?: "active" };
      /** the row operations, by the shop's batch route */
      prices: {
        create: { amount: number }[];
        update: { id: string; amount: number }[];
        delete: string[];
      };
    }
  /** a sale that is not wanted any more: its list goes (the shop has already ended it by the clock, or the sale was removed) */
  | { kind: "delete"; listId: string };

const instant = (value: Date | string | null): number | null =>
  value === null ? null : new Date(value).getTime();

const sameInstant = (existing: string | null, wanted: Date | null): boolean =>
  instant(existing) === instant(wanted);

/**
 * THE DECISION. `existing` is the list found by the key (the caller refuses a second one: two lists under one key are a
 * state this planner does not guess about), `wanted` the sale the OS holds for the variant right now (`null`: none).
 *
 * An update touches only what differs, and the list row is changed IN PLACE (its id stays): a delete and a create would
 * leave the variant without the list between the two calls.
 */
export function planSaleList(
  existing: ExistingSaleList | null,
  wanted: WantedSale | null,
  /** the Medusa variant the key names: a row for ANOTHER variant is not ours to keep (barracuda, #2733) */
  variantId: string,
  currencyCode = "huf",
): SaleListPlan {
  if (wanted === null)
    return existing
      ? { kind: "delete", listId: existing.id }
      : { kind: "none" };
  if (existing === null) return { kind: "create", wanted };

  /*
    OUR ROW: this currency AND this variant, WHEN THE ROW SAYS ITS VARIANT. MEASURED on the test Medusa (acrobot, 2026-11-19
    02:13): the price list query's rows carry a `price_set_id` and NO `variant_id`, so on the real shop `variantId` is
    `null` here and a row is ours by the currency alone: a row for another variant put on our list by hand in the admin is
    NOT recognised today (it would be kept or rewritten as "the" price). The check below only works for an answer that does
    bring the variant; keying on the variant's price set instead (known from the variant read) is the way to make it
    effective, and is left out as not worth it for a rare manual intervention (barracuda, #2733: not a condition).
  */
  const isOurs = (price: ExistingSaleList["prices"][number]) =>
    price.currencyCode.toLowerCase() === currencyCode &&
    (price.variantId === null || price.variantId === variantId);
  const ours = existing.prices.filter(isOurs);
  const list: Extract<SaleListPlan, { kind: "update" }>["list"] = {};
  if (!sameInstant(existing.startsAt, wanted.startsAt))
    list.startsAt = wanted.startsAt;
  if (!sameInstant(existing.endsAt, wanted.endsAt)) list.endsAt = wanted.endsAt;
  if (existing.status !== "active") list.status = "active";

  const prices: Extract<SaleListPlan, { kind: "update" }>["prices"] = {
    create: [],
    update: [],
    delete: [],
  };
  const [keep, ...extra] = ours;
  if (!keep) prices.create.push({ amount: wanted.amount });
  else if (keep.amount !== wanted.amount)
    prices.update.push({ id: keep.id, amount: wanted.amount });
  prices.delete.push(...extra.map((price) => price.id));
  // a row in another currency, or for another variant, is not ours to keep on a list that holds one price
  prices.delete.push(
    ...existing.prices
      .filter((price) => !isOurs(price))
      .map((price) => price.id),
  );

  const changesList = Object.keys(list).length > 0;
  const changesPrices =
    prices.create.length + prices.update.length + prices.delete.length > 0;
  if (!changesList && !changesPrices)
    return { kind: "unchanged", listId: existing.id };
  return { kind: "update", listId: existing.id, list, prices };
}
