import {
  WEBSHOP_ORDER_CLOSED_STATUSES,
  WEBSHOP_ORDER_STAGES,
  WEBSHOP_ORDER_STALE_DEFAULTS,
  WEBSHOP_ORDER_STATUSES,
  WEBSHOP_ORDER_STATUS_LABELS,
  pointKindOf,
  type WebshopOrderDetail,
  type WebshopOrderListItem,
  type WebshopOrderListQuery,
  type WebshopOrderPaymentState,
  type WebshopOrderStage,
  type WebshopOrderStatus,
} from "@acropora/types";

import { holdWarningOf } from "./webshop-order-card-payment.rules.js";
import type { MedusaOrderOverviewRow } from "../../integrations/medusa/medusa-admin.client.js";

/**
 * A WEBSHOP RENDELÉSLISTA SZABÁLYAI, adatbázis és hálózat nélkül: a webshop
 * sorából a lista sora, a számlálók, a szűrés, a rendezés és a lapozás.
 */

/** A webshop szállítási módja a seed nevével (commerce `initial-data-seed.ts`). */
export const STORE_PICKUP_METHOD = "Bolti átvétel";

/**
 * A FIZETÉSI SZOLGÁLTATÓ NEVE. Csak a két biztos azonosító kap nevet: a
 * szolgáltatók szerepét a webshop környezeti változói osztják ki, az OS nem
 * látja, tehát a többit nem találgatjuk, hanem kiírjuk.
 */
export function paymentMethodLabel(providerId: string | null): string | null {
  if (!providerId) return null;
  if (providerId === "pp_stripe_stripe") return "Stripe";
  if (providerId === "pp_acropora_cod") return "Utánvét";
  return `Egyéb (${providerId})`;
}

/** A fizetés állapota a fizetési gyűjtő összegeiből és állapotából. */
export function paymentStateOf(
  payment: MedusaOrderOverviewRow["payment"],
): WebshopOrderPaymentState | null {
  if (!payment) return null;
  const captured = payment.captured_amount ?? 0;
  const refunded = payment.refunded_amount ?? 0;
  if (refunded > 0)
    return captured > 0 && refunded >= captured
      ? "REFUNDED"
      : "PARTIALLY_REFUNDED";
  if (payment.status === "canceled") return "CANCELED";
  if (payment.status === "failed") return "FAILED";
  if (captured > 0 || payment.status === "completed") return "CAPTURED";
  if (
    payment.status === "authorized" ||
    payment.status === "partially_authorized"
  )
    return "AUTHORIZED";
  return "AWAITING";
}

const isStatus = (code: string | null): code is WebshopOrderStatus =>
  code !== null && (WEBSHOP_ORDER_STATUSES as readonly string[]).includes(code);

/** Elavult-e: a státuszban töltött idő elérte a küszöböt (ha a státusznak van). */
export function isStale(
  code: WebshopOrderStatus | null,
  changedAt: string | null,
  now: Date,
  thresholds = WEBSHOP_ORDER_STALE_DEFAULTS,
): boolean {
  if (!code || !changedAt) return false;
  const threshold = thresholds[code];
  if (!threshold) return false;
  return (
    now.getTime() - new Date(changedAt).getTime() >= threshold.hours * 3_600_000
  );
}

/** Az OS saját tényei egy rendelésről (számla, küldemény). */
export interface WebshopOrderFacts {
  /** CSAK a kiállított számla száma: a vázlat még nem számla. */
  invoiceNumber: string | null;
  invoice: WebshopOrderDetail["invoice"];
  /** CSAK a létrejött csomag (van csomagszáma): a foglalás még nem csomag. */
  hasParcel: boolean;
  parcel: WebshopOrderDetail["parcel"];
}
export const NO_FACTS: WebshopOrderFacts = {
  invoiceNumber: null,
  invoice: null,
  hasParcel: false,
  parcel: null,
};

/** A tények a rendelés számlájából és aktív csomagjából. */
export function factsOf(
  invoice: WebshopOrderDetail["invoice"] | undefined,
  parcel: WebshopOrderDetail["parcel"] = null,
): WebshopOrderFacts {
  return {
    invoiceNumber:
      invoice?.status === "ISSUED" ? (invoice.number ?? null) : null,
    invoice: invoice ?? null,
    hasParcel: !!parcel?.parcelNumber,
    parcel,
  };
}

/**
 * MELYIK SZÁMLÁLÓBA ESIK. Előbb számla, utána csomag (Balázs, 2026-10-05
 * 11:24): a visszaigazolt vagy készletezett rendelés számla nélkül „Számlára
 * vár”, számlával és csomag nélkül „Feladásra vár” (bolti átvételnél nincs
 * csomag, ott a következő lépés az „Átvehető”).
 */
export function stageOf(
  code: WebshopOrderStatus | null,
  storePickup: boolean,
  facts: WebshopOrderFacts,
): WebshopOrderListItem["stage"] {
  if (code === "pending_processing") return "processing";
  if (code === "ready_for_pickup") return "pickup";
  if (code === "confirmed" || code === "stocking") {
    if (!facts.invoiceNumber) return "invoice";
    if (!storePickup && !facts.hasParcel) return "dispatch";
  }
  return null;
}

export function toListItem(
  row: MedusaOrderOverviewRow,
  facts: WebshopOrderFacts,
  now: Date,
  thresholds = WEBSHOP_ORDER_STALE_DEFAULTS,
): WebshopOrderListItem {
  const code = isStatus(row.business_status.code)
    ? row.business_status.code
    : null;
  const storePickup = row.shipping_method === STORE_PICKUP_METHOD;
  return {
    id: row.id,
    displayId: row.display_id,
    createdAt: row.created_at,
    total: row.total,
    currency: (row.currency_code ?? "huf").toUpperCase(),
    customer: {
      name: row.customer_name,
      email: row.email,
      phone: row.phone,
      isNew: row.customer_signals.is_new_customer,
      unsuccessfulOrderCount:
        row.customer_signals.unsuccessful_closed_order_count,
      hasOtherOpenOrder: row.customer_signals.has_other_open_order,
      guest: row.customer_signals.purchased_without_registration,
    },
    shipping: {
      method: row.shipping_method,
      pickupPoint: row.pickup_point?.name ?? null,
      pointKind: pointKindOf(row.pickup_point?.type),
      storePickup,
    },
    payment: {
      method: paymentMethodLabel(row.payment?.provider_id ?? null),
      state: paymentStateOf(row.payment),
      holdExpiresAt: row.payment?.hold_expires_at ?? null,
      holdWarning: holdWarningOf(row.payment?.hold_expires_at, code, now),
    },
    invoiceNumber: facts.invoiceNumber,
    status: {
      code,
      label: code ? WEBSHOP_ORDER_STATUS_LABELS[code] : null,
      changedAt: row.business_status.changed_at,
      stale: isStale(code, row.business_status.changed_at, now, thresholds),
    },
    stage: stageOf(code, storePickup, facts),
    relatedOrder: row.related_order,
  };
}

const isOpen = (item: WebshopOrderListItem) =>
  !item.status.code ||
  !WEBSHOP_ORDER_CLOSED_STATUSES.includes(item.status.code);

/** A számlálók a nézet halmazán (Nyitott/Összes), a többi szűrőtől függetlenül. */
export function countersOf(
  items: readonly WebshopOrderListItem[],
): Record<WebshopOrderStage, number> {
  const counters = Object.fromEntries(
    WEBSHOP_ORDER_STAGES.map((stage) => [stage, 0]),
  ) as Record<WebshopOrderStage, number>;
  for (const item of items) {
    if (item.stage) counters[item.stage] += 1;
    if (item.status.stale) counters.stale += 1;
  }
  return counters;
}

const BUDAPEST_DAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** A leadás napja budapesti idő szerint (a szűrő napjai ott értendők). */
export const budapestDay = (iso: string) => BUDAPEST_DAY.format(new Date(iso));

const digits = (value: string) => value.replace(/\D/g, "");

/** Rendelésszám (#38 vagy 38), név, e-mail, telefon (számjegyekre) és számlaszám szerint. */
export function matchesSearch(item: WebshopOrderListItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const numeric = needle.replace(/^#/, "");
  if (/^\d+$/.test(numeric) && String(item.displayId) === numeric) return true;
  const haystack = [item.customer.name, item.customer.email, item.invoiceNumber]
    .filter(Boolean)
    .map((value) => value!.toLowerCase());
  if (haystack.some((value) => value.includes(needle))) return true;
  const needleDigits = digits(needle);
  return (
    needleDigits.length >= 6 &&
    !!item.customer.phone &&
    digits(item.customer.phone).includes(needleDigits)
  );
}

/** A nézet (Nyitott/Összes): ezen számolódnak a számlálók. */
export function inView(
  items: readonly WebshopOrderListItem[],
  view: WebshopOrderListQuery["view"],
): WebshopOrderListItem[] {
  return view === "all" ? [...items] : items.filter(isOpen);
}

export function applyFilters(
  items: readonly WebshopOrderListItem[],
  query: WebshopOrderListQuery,
): WebshopOrderListItem[] {
  return items.filter((item) => {
    if (query.stage === "stale" && !item.status.stale) return false;
    if (query.stage && query.stage !== "stale" && item.stage !== query.stage)
      return false;
    if (query.q && !matchesSearch(item, query.q)) return false;
    const day = budapestDay(item.createdAt);
    if (query.from && day < query.from) return false;
    if (query.to && day > query.to) return false;
    if (query.status && item.status.code !== query.status) return false;
    if (query.shippingMethod && item.shipping.method !== query.shippingMethod)
      return false;
    if (query.paymentMethod && item.payment.method !== query.paymentMethod)
      return false;
    if (query.paymentState && item.payment.state !== query.paymentState)
      return false;
    if (query.invoice === "issued" && !item.invoiceNumber) return false;
    if (query.invoice === "missing" && item.invoiceNumber) return false;
    if (query.customerType === "guest" && !item.customer.guest) return false;
    if (query.customerType === "registered" && item.customer.guest)
      return false;
    if (
      query.newCustomer !== undefined &&
      item.customer.isNew !== query.newCustomer
    )
      return false;
    return true;
  });
}

const STATUS_ORDER = new Map(
  WEBSHOP_ORDER_STATUSES.map((status, index) => [status, index]),
);
const byName = new Intl.Collator("hu");

/** Rendezés; azonos kulcsnál a leadás ideje dönt (újabb elöl), hogy a sorrend stabil legyen. */
export function sortItems(
  items: readonly WebshopOrderListItem[],
  sort: WebshopOrderListQuery["sort"] = "createdAt",
  direction: WebshopOrderListQuery["direction"] = "desc",
): WebshopOrderListItem[] {
  const sign = direction === "asc" ? 1 : -1;
  const key = (a: WebshopOrderListItem, b: WebshopOrderListItem): number => {
    switch (sort) {
      case "displayId":
        return a.displayId - b.displayId;
      case "customer":
        return byName.compare(a.customer.name ?? "", b.customer.name ?? "");
      case "total":
        return a.total - b.total;
      case "status":
        return (
          (STATUS_ORDER.get(a.status.code!) ?? 99) -
          (STATUS_ORDER.get(b.status.code!) ?? 99)
        );
      default:
        return a.createdAt.localeCompare(b.createdAt);
    }
  };
  return [...items].sort(
    (a, b) =>
      sign * key(a, b) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

export const distinctSorted = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((value): value is string => !!value))].sort(
    byName.compare,
  );
