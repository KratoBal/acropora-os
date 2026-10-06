import {
  WEBSHOP_ORDER_STATUSES,
  WEBSHOP_ORDER_STATUS_LABELS,
  pointKindOf,
  type WebshopOrderAddress,
  type WebshopOrderDetail,
  type WebshopOrderLine,
  type WebshopOrderStatus,
  type WebshopOrderStep,
} from "@acropora/types";

import type {
  MedusaOrderAddressRow,
  MedusaOrderBusinessStatus,
  MedusaOrderDetailRow,
  MedusaOrderPayment,
} from "../../integrations/medusa/medusa-admin.client.js";
import { addressEditOf } from "./webshop-order-address.rules.js";
import { cardPaymentOf } from "./webshop-order-card-payment.rules.js";
import { lineEditRefusal } from "./webshop-order-lines.rules.js";
import {
  STORE_PICKUP_METHOD,
  isStale,
  paymentMethodLabel,
  paymentStateOf,
  type WebshopOrderFacts,
} from "./webshop-orders.rules.js";

/**
 * A WEBSHOP RENDELÉS ADATLAPJÁNAK SZABÁLYAI, hálózat nélkül: a Medusa
 * rendelés-részletéből és a webshop üzleti státuszából az OS adatlapja.
 */

const isStatus = (
  code: string | null | undefined,
): code is WebshopOrderStatus =>
  !!code && (WEBSHOP_ORDER_STATUSES as readonly string[]).includes(code);

/**
 * A NÉV MAGYAR SORRENDBEN: vezetéknév, keresztnév. A kirakat `last_name`
 * mezője a vezetéknév (a címűrlapon „Vezetéknév”, `family-name`), tehát az
 * elöl áll; ugyanez kerül a számlára is (`webshop-order-invoice.rules.ts`).
 */
const nameOf = (address: MedusaOrderAddressRow | null | undefined) =>
  [address?.last_name, address?.first_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || null;

export function addressOf(
  address: MedusaOrderAddressRow | null | undefined,
): WebshopOrderAddress | null {
  if (!address) return null;
  const place = [address.postal_code, address.city]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const street = [address.address_1, address.address_2]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const line = [place, street].filter(Boolean).join(", ") || null;
  const taxId = address.metadata?.tax_id;
  const result = {
    name: nameOf(address),
    company: address.company?.trim() || null,
    line,
    countryCode: address.country_code?.toUpperCase() ?? null,
    phone: address.phone?.trim() || null,
    fields: {
      lastName: address.last_name?.trim() ?? "",
      firstName: address.first_name?.trim() ?? "",
      company: address.company?.trim() || null,
      taxNumber:
        typeof taxId === "string" && taxId.trim() ? taxId.trim() : null,
      postalCode: address.postal_code?.trim() ?? "",
      city: address.city?.trim() ?? "",
      line1: address.address_1?.trim() ?? "",
      line2: address.address_2?.trim() || null,
      phone: address.phone?.trim() || null,
      countryCode: (address.country_code ?? "hu").toUpperCase(),
    },
  };
  return result.name || result.company || result.line ? result : null;
}

/**
 * A DÍJSOR NEM TERMÉK. Az utánvét kezelési díja a webshopban külön tételsor,
 * a metaadata jelöli (commerce `goods-total.ts`, `cod-fee-line-item.ts`); a
 * címe NEM azonosító. A díjsorok a tételek közül kimaradnak, az összegük
 * külön sor az összesítésben.
 */
const isFee = (item: MedusaOrderDetailRow["items"][number]) =>
  item.metadata?.acropora_line_item_kind === "fee";

export function linesOf(items: MedusaOrderDetailRow["items"]): {
  lines: WebshopOrderLine[];
  feeTotal: number;
} {
  const lines = items
    .filter((item) => !isFee(item))
    .map((item) => ({
      id: item.id,
      title: item.product_title || item.title,
      variantTitle:
        item.variant_title &&
        item.variant_title !== item.product_title &&
        !/^default/i.test(item.variant_title)
          ? item.variant_title
          : null,
      sku: item.variant_sku,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      total: Number(item.total),
    }));
  const feeTotal = items
    .filter(isFee)
    .reduce((sum, item) => sum + Number(item.total), 0);
  return { lines, feeTotal };
}

type PickupPointData = {
  id?: string;
  name?: string;
  address?: string;
  type?: string;
} | null;

export function shippingOf(
  methods: MedusaOrderDetailRow["shipping_methods"],
): WebshopOrderDetail["shipping"] {
  const method = methods[0];
  const data = (method?.data ?? {}) as {
    foxpost_pickup_point?: PickupPointData;
    gls_pickup_point?: PickupPointData;
  };
  const foxpost = data.foxpost_pickup_point ?? null;
  const gls = data.gls_pickup_point ?? null;
  const point = foxpost ?? gls;
  const name = method?.name ?? null;
  return {
    method: name,
    storePickup: name === STORE_PICKUP_METHOD,
    carrier:
      foxpost || /foxpost/i.test(name ?? "")
        ? "FOXPOST"
        : gls || /^gls/i.test(name ?? "")
          ? "GLS"
          : null,
    pickupPoint: point?.name
      ? {
          id: point.id ?? null,
          name: point.name,
          address: point.address ?? null,
          kind: gls ? pointKindOf(point.type) : null,
        }
      : null,
  };
}

export function paymentOf(
  collections: MedusaOrderDetailRow["payment_collections"],
  total: number,
): WebshopOrderDetail["payment"] {
  const collection = collections[0];
  if (!collection) return null;
  const payment = collection.payments?.[0];
  const providerId = payment?.provider_id ?? null;
  const intent = payment?.data?.id;
  return {
    method: paymentMethodLabel(providerId),
    state: paymentStateOf({
      provider_id: providerId,
      status: collection.status,
      amount: collection.amount,
      captured_amount: collection.captured_amount,
      refunded_amount: collection.refunded_amount,
    }),
    authorized:
      collection.authorized_amount != null
        ? Number(collection.authorized_amount)
        : collection.amount != null
          ? Number(collection.amount)
          : null,
    toCapture: total,
    captured: Number(collection.captured_amount ?? 0),
    refunded: Number(collection.refunded_amount ?? 0),
    // CSAK az azonosító: a PaymentIntent többi mezője (a client_secret is) a szerveren marad
    stripePaymentIntentId:
      providerId === "pp_stripe_stripe" &&
      typeof intent === "string" &&
      intent.startsWith("pi_")
        ? intent
        : null,
  };
}

const AFTER = (
  code: WebshopOrderStatus | null,
  ...codes: WebshopOrderStatus[]
) => code !== null && codes.includes(code);

/**
 * A FELDOLGOZÁSI SÁV (a prompt 5. pontja). Kiszállításnál öt lépés, bolti
 * átvételnél négy. Az első nem kész lépés a jelenlegi; egy későbbi lépés,
 * aminek konkrét akadálya van, „blocked” a mondatával (a csomag a számla
 * előtt: „Előbb állítsd ki a számlát”). Sikertelenül lezárt rendelésnél nincs
 * jelenlegi lépés.
 */
export function stepsOf(
  code: WebshopOrderStatus | null,
  storePickup: boolean,
  facts: WebshopOrderFacts,
  cardPayment: boolean,
): WebshopOrderStep[] {
  const confirmed = AFTER(
    code,
    "confirmed",
    "stocking",
    "out_for_delivery",
    "ready_for_pickup",
    "closed",
  );
  const draft: Omit<WebshopOrderStep, "state">[] = [];
  const done = new Set<string>();
  const blocked = new Map<string, string>();
  draft.push({
    key: "confirm",
    label: "Visszaigazolás",
    detail: confirmed ? "Visszaigazolva" : "Visszaigazolásra vár",
  });
  if (confirmed) done.add("confirm");
  draft.push({
    key: "invoice",
    label: "Számla",
    detail: facts.invoiceNumber ?? "Számla kiállítása",
  });
  if (facts.invoiceNumber) done.add("invoice");
  if (storePickup) {
    draft.push({
      key: "pickup",
      label: "Átvehető",
      detail: "Értesítés a vevőnek",
    });
    if (AFTER(code, "ready_for_pickup", "closed")) done.add("pickup");
    draft.push({
      key: "closed",
      label: "Átvéve a boltban",
      detail: "Végállapot",
    });
  } else {
    draft.push({
      key: "parcel",
      label: "Csomag",
      detail: facts.parcel?.parcelNumber ?? "Csomagfeladás",
    });
    if (facts.hasParcel) done.add("parcel");
    else if (!facts.invoiceNumber)
      blocked.set("parcel", "Előbb állítsd ki a számlát");
    draft.push({
      key: "delivery",
      label: "Kiszállítás",
      detail: cardPayment ? "Levonás a kártyáról" : "Átadás a futárnak",
    });
    if (AFTER(code, "out_for_delivery", "closed")) done.add("delivery");
    draft.push({
      key: "closed",
      label: "Átvéve / Lezárva",
      detail: "Végállapot",
    });
  }
  if (code === "closed") done.add("closed");

  let currentGiven = code === "closed_unsuccessfully";
  return draft.map((step) => {
    if (done.has(step.key)) return { ...step, state: "done" as const };
    const reason = blocked.get(step.key);
    if (!currentGiven) {
      currentGiven = true;
      return reason
        ? { ...step, detail: reason, state: "blocked" as const }
        : { ...step, state: "current" as const };
    }
    return reason
      ? { ...step, detail: reason, state: "blocked" as const }
      : { ...step, state: "todo" as const };
  });
}

/** A történet: a státusz-váltások, a létrejövéssel kezdve. */
export function historyOf(
  status: MedusaOrderBusinessStatus | null,
): WebshopOrderDetail["history"] {
  return (status?.history ?? []).map((entry) => ({
    at: entry.created_at,
    text:
      entry.from_status === null
        ? `Rendelés létrejött · ${entry.to_label}`
        : `${entry.from_label} → ${entry.to_label}${entry.actor === "carrier" ? " (futár)" : entry.source === "payment_deadline" ? " (fizetési határidő lejárt, rendszer)" : ""}`,
    mail: entry.notification
      ? {
          status: entry.notification.status,
          at: entry.notification.at,
          resent: entry.notification.resent,
        }
      : null,
  }));
}

const relatedOf = (
  metadata: Record<string, unknown> | null,
): { id: string; role: "pickup" | "parent" } | null => {
  const pickup = metadata?.acropora_pickup_order_id;
  if (typeof pickup === "string" && pickup)
    return { id: pickup, role: "pickup" };
  const parent = metadata?.acropora_parent_order_id;
  if (typeof parent === "string" && parent)
    return { id: parent, role: "parent" };
  return null;
};

export function toDetail(input: {
  order: MedusaOrderDetailRow;
  status: MedusaOrderBusinessStatus | null;
  facts: WebshopOrderFacts;
  customerOrderCount: number | null;
  relatedDisplayId: number | null;
  now: Date;
  /** A vevő OS-partnere, ha a számlázás bekötötte. */
  osCustomer?: WebshopOrderDetail["osCustomer"];
  /** A belső megjegyzés (csak OS). */
  internalNote?: WebshopOrderDetail["internalNote"];
  /** Az elavulási küszöbök órában (a beállított; ha hiányzik, az alapérték). */
  staleHours?: Partial<Record<WebshopOrderStatus, { hours: number }>>;
  /** A kártyás fizetés útja a webshopból; `null` vagy hiányzó: nincs ilyen (vagy nem olvasható). */
  orderPayment?: MedusaOrderPayment | null;
}): WebshopOrderDetail {
  const { order, status, facts, now } = input;
  const code = isStatus(status?.status) ? status!.status : null;
  const total = Number(order.total);
  const { lines, feeTotal } = linesOf(order.items ?? []);
  const shipping = shippingOf(order.shipping_methods ?? []);
  const payment = paymentOf(order.payment_collections ?? [], total);
  const billing = addressOf(order.billing_address);
  const delivery = addressOf(order.shipping_address);
  const related = relatedOf(order.metadata);
  return {
    id: order.id,
    displayId: order.display_id,
    createdAt: order.created_at,
    currency: (order.currency_code ?? "huf").toUpperCase(),
    status: {
      code,
      label: code ? WEBSHOP_ORDER_STATUS_LABELS[code] : null,
      changedAt: status?.changed_at ?? null,
      stale: isStale(code, status?.changed_at ?? null, now, input.staleHours),
    },
    nextStatuses: (status?.next_statuses ?? [])
      .filter((next) => isStatus(next.status))
      .map((next) => ({
        status: next.status as WebshopOrderStatus,
        label: next.label,
      })),
    customer: {
      name: delivery?.name ?? billing?.name ?? null,
      email: order.email ?? "",
      phone: delivery?.phone ?? billing?.phone ?? null,
      isNew: input.customerOrderCount === 1,
      guest: !order.customer_id,
    },
    billingAddress: billing,
    shippingAddress: delivery,
    shipping,
    lines,
    totals: {
      subtotal: lines.reduce((sum, line) => sum + line.total, 0),
      discount: Number(order.discount_total ?? 0),
      shipping: Number(order.shipping_total ?? 0),
      codFee: feeTotal,
      total,
    },
    payment,
    invoiceNumber: facts.invoiceNumber,
    invoice: facts.invoice,
    parcel: facts.parcel,
    cardPayment: cardPaymentOf(input.orderPayment ?? null, code, now),
    osCustomer: input.osCustomer ?? null,
    internalNote: input.internalNote ?? null,
    addressEdit: addressEditOf({
      status: code,
      invoice: facts.invoice,
      parcel: facts.parcel,
    }),
    lineEdit: (() => {
      const reason = lineEditRefusal({
        status: code,
        invoice: facts.invoice,
        parcel: facts.parcel,
      });
      return { allowed: reason === null, reason };
    })(),
    steps: stepsOf(
      code,
      shipping.storePickup,
      facts,
      payment?.method === "Stripe",
    ),
    relatedOrder: related
      ? { ...related, displayId: input.relatedDisplayId }
      : null,
    history: historyOf(status),
  };
}
