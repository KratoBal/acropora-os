import {
  WEBSHOP_ORDER_STATUSES,
  WEBSHOP_ORDER_STATUS_LABELS,
  foxpostPointType,
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
  MedusaOrderOverviewRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  addressEditOf,
  notesEditOf,
  notesOf,
  methodEditOf,
  pointEditOf,
} from "./webshop-order-address.rules.js";
import { cardPaymentOf } from "./webshop-order-card-payment.rules.js";
import { lineEditRefusal } from "./webshop-order-lines.rules.js";
import { orderCreditsOf } from "./webshop-order-credits.rules.js";
import {
  isStorePickupMethod,
  storePickupOptionIdFrom,
  BANK_TRANSFER_PROVIDER_ID,
  isStale,
  orderPaymentProviderId,
  paymentMethodLabel,
  paymentStateOf,
  type WebshopOrderFacts,
  primaryPaymentCollection,
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
  /** Foxpost: a pont típusa a Foxpost saját címkéjével („FOXPOST Z-BOX”). */
  variant?: string;
} | null;

export function shippingOf(
  methods: MedusaOrderDetailRow["shipping_methods"],
  pickupOptionId: string | null = storePickupOptionIdFrom(),
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
    storePickup: isStorePickupMethod(
      { shippingOptionId: method?.shipping_option_id, name },
      pickupOptionId,
    ),
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
          type: foxpost?.variant?.trim()
            ? foxpostPointType(foxpost.variant)
            : null,
        }
      : null,
  };
}

export function paymentOf(
  collections: MedusaOrderDetailRow["payment_collections"],
  total: number,
): WebshopOrderDetail["payment"] {
  const collection = primaryPaymentCollection(collections);
  if (!collection) return null;
  const payment = collection.payments?.[0];
  // a függő fizetésnek csak munkamenete van (lásd orderPaymentProviderId)
  const providerId = orderPaymentProviderId(collection);
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

/** Előre utalásnál a Számla lépés: a számla a Számlázz.hu-tól jön. */
export const TRANSFER_INVOICE_STEP = "A Számlázz.hu állítja ki a kifizetéskor";
/** Előre utalásnál a csomag oka: nem kiállítás kell, hanem a kifizetés. */
export const TRANSFER_PARCEL_WAIT = "A számla a díjbekérő kifizetése után jön";

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
  bankTransfer: boolean,
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
    /*
      ELŐRE UTALÁSNÁL A SZÁMLA NEM AZ OS DOLGA (bb3a6bd5): a Számlázz.hu
      Autokassza állítja ki a kifizetett díjbekérőből, és az OS 409-cel
      elutasítja a kiállítást. A lépés tehát nem hívhat kiállításra; azt
      mondja meg, mire vár. Stage-próba, 2026-10-07: a #56-on ez a lépés még
      „Számla kiállítása” volt.
    */
    detail:
      facts.invoiceNumber ??
      (bankTransfer ? TRANSFER_INVOICE_STEP : "Számla kiállítása"),
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
      blocked.set(
        "parcel",
        bankTransfer ? TRANSFER_PARCEL_WAIT : "Előbb állítsd ki a számlát",
      );
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

/**
 * A SZÉTBONTÁS KULCSAI (commerce, murena 26630): az eredetin
 * `acropora_split_order_ids`, a bontotton `acropora_split_from_order_id`.
 * Szándékosan nem a vegyes kosár kulcsai: azokból a közös kártyás levonás a
 * párt keresi, és a bontott rendelés nem ül az eredeti zárolásán.
 */
export function splitIdsOf(metadata: Record<string, unknown> | null): {
  from: string | null;
  into: string[];
} {
  const from = metadata?.acropora_split_from_order_id;
  const into = metadata?.acropora_split_order_ids;
  return {
    from: typeof from === "string" && from ? from : null,
    into: Array.isArray(into)
      ? into.filter((id): id is string => typeof id === "string" && !!id)
      : [],
  };
}

/**
 * A FÉLBEMARADT SZÉTBONTÁS (commerce #504, acrobot 26807): az eredeti
 * `acropora_split_requests` rekordjai közül az első, ami nincs kész. A
 * tételei már kikerültek innen; a webshop a következő kérésre befejezi.
 */
export function unfinishedSplitOf(
  metadata: Record<string, unknown> | null,
): WebshopOrderDetail["split"]["unfinished"] {
  const requests = metadata?.acropora_split_requests;
  if (!requests || typeof requests !== "object") return null;
  for (const [requestId, record] of Object.entries(
    requests as Record<string, unknown>,
  )) {
    if (!record || typeof record !== "object") continue;
    const { done, moved } = record as { done?: unknown; moved?: unknown };
    if (done === true || !Array.isArray(moved)) continue;
    const lines = moved.flatMap((line: unknown) => {
      const { from_item_id, title, quantity } = (line ?? {}) as Record<
        string,
        unknown
      >;
      return typeof from_item_id === "string" &&
        from_item_id !== "" &&
        Number.isInteger(quantity) &&
        (quantity as number) > 0
        ? [
            {
              itemId: from_item_id,
              title: typeof title === "string" ? title : "",
              quantity: quantity as number,
            },
          ]
        : [];
    });
    if (lines.length) return { requestId, lines };
  }
  return null;
}

/**
 * A KÉZI KÁRTYA-VISSZATÉRÍTÉS JELZÉSE (kártya 527ba41e). A webshop a sikertelen lezáráskor, ha a rendelést nem tudja lemondani (feladott
 * csomag: nyitott fulfillment), a pontot és az ajándékkártyát közvetlenül adja vissza, és a rendelés metaadatán nyomot hagy
 * (`unsuccessful_close_credits_given_back`: `credit_lines`, `captured_unrefunded`, `at`). A kártyán rögzített összeget ilyenkor senki nem
 * téríti vissza, és eddig csak egy naplósor szólt róla. Itt lesz belőle a rendelés-oldal jelzése: CSAK akkor, ha tényleg van vissza nem
 * térített rögzített összeg (> 0); a nyom nélküli vagy nulla összegű rendelés `null`.
 *
 * A JELZÉS ELTŰNIK, AMIKOR A TEENDŐ MEGVAN (barracuda, OS #2833): a nyom a lezárás PILLANATÁNAK összegét őrzi, ezért az összeg a webshop
 * fizetésének mostani állásából is számolódik: a rögzített mínusz a visszatérített (`outstanding`). A jelzett összeg a kettő KISEBBIKE, és
 * 0-nál a jelzés megszűnik. Így egy a webshopon át (a Medusa adminból) indított visszatérítés kioltja; a Stripe irányítópultján indított
 * visszatérítést a webshop nem látja, azt egy külön „Visszatérítve” jelölés oldaná meg (külön kártya). Ha a fizetés összegei nem
 * olvashatók (`outstanding` hiányzik), a nyom összege marad.
 */
export function manualRefundOf(
  metadata: Record<string, unknown> | null | undefined,
  outstanding?: number | null,
): {
  amount: number;
  creditLines: number;
  at: string | null;
  settled: { by: string; at: string; note: string | null } | null;
} | null {
  const mark = metadata?.unsuccessful_close_credits_given_back;
  if (!mark || typeof mark !== "object") return null;
  const {
    captured_unrefunded,
    credit_lines,
    at,
    settled_at,
    settled_by,
    settled_note,
  } = mark as Record<string, unknown>;
  const marked = Number(captured_unrefunded);
  if (!Number.isFinite(marked) || marked <= 0) return null;
  const lines = Number(credit_lines);
  const base = {
    creditLines: Number.isFinite(lines) && lines > 0 ? lines : 0,
    at: typeof at === "string" ? at : null,
  };
  /*
    RENDEZVE (kártya abf3f8f4): a nyomra valaki ráírta, hogy a visszatérítést elvégezte (a Stripe irányítópultján, amit a webshop nem lát).
    A jelzés helyén ilyenkor ki és mikor áll, és a nyom megmarad: a lezárás története nem tűnik el. A jelzett összeg a nyomé (a
    rendezéskor kimondott összeg), nem a webshop mostani maradéka.
  */
  if (typeof settled_at === "string" && settled_at) {
    return {
      amount: marked,
      ...base,
      settled: {
        by: typeof settled_by === "string" ? settled_by : "",
        at: settled_at,
        note: typeof settled_note === "string" ? settled_note : null,
      },
    };
  }
  const amount =
    typeof outstanding === "number" && Number.isFinite(outstanding)
      ? Math.min(marked, outstanding)
      : marked;
  if (!(amount > 0)) return null;
  return { amount, ...base, settled: null };
}

/** A webshop fizetéseinek vissza nem térített, rögzített összege; `null`: nem olvasható (nincs fizetési gyűjtemény). */
/**
 * ÁTÁLLÍTHATÓ-E ELŐRE UTALÁSRA (kártya d31a66a3). A webshop maga is elutasítja, amit nem lehet (kifizetett, úton levő vagy lezárt
 * rendelés, vegyes kosár párja, ismeretlen mód); itt a gomb már előtte megmondja, miért nincs. A kiállított számla mellett nem
 * állítunk át: a díjbekérő és a számla ugyanarra a rendelésre két különböző fizetést mondana.
 */
export function transferSwitchOf(input: {
  bankTransfer: boolean;
  status: WebshopOrderStatus | null;
  paymentMethod: string | null;
  paymentState: string | null;
  invoice: unknown;
  related: boolean;
}): { allowed: boolean; reason: string | null } {
  const reason = input.bankTransfer
    ? "A rendelés már előre utalásos."
    : input.status === "out_for_delivery" ||
        input.status === "closed" ||
        input.status === "closed_unsuccessfully"
      ? "A rendelés már úton van vagy lezárult."
      : input.related
        ? "Vegyes kosár rendelése (élő állat és kiszállítandó tétel két rendelésben): most nem állítható át."
        : input.invoice
          ? "A rendelésen már van számla."
          : input.paymentState === "CAPTURED" ||
              input.paymentState === "PARTIALLY_REFUNDED" ||
              input.paymentState === "REFUNDED"
            ? "A rendelést már kifizették."
            : !input.paymentMethod
              ? "A rendelés fizetési módja nem ismert."
              : null;
  return { allowed: reason === null, reason };
}

export function outstandingCapturedOf(
  collections: MedusaOrderDetailRow["payment_collections"] | undefined,
): number | null {
  if (!collections?.length) return null;
  let captured = 0;
  let refunded = 0;
  for (const collection of collections) {
    captured += Number(collection.captured_amount ?? 0);
    refunded += Number(collection.refunded_amount ?? 0);
  }
  return captured - refunded;
}

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
  deliveryNote?: WebshopOrderDetail["deliveryNote"];
  /** A díjbekérő (bb3a6bd5); nincs: `null`. */
  proforma?: WebshopOrderDetail["proforma"];
  transferReceipt?: WebshopOrderDetail["transferReceipt"];
  externalInvoice?: WebshopOrderDetail["externalInvoice"];
  split?: WebshopOrderDetail["split"];
  /** A vevő jelzései a webshop áttekintéséből; `null`: nem olvasható. */
  signals?: MedusaOrderOverviewRow["customer_signals"] | null;
  /** A csomagfeladás előnézete (`parcelInputOf`); bolti átvételnél `null`. */
  dispatchPreview?: WebshopOrderDetail["dispatchPreview"];
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
  const bankTransfer =
    orderPaymentProviderId(
      primaryPaymentCollection(order.payment_collections),
    ) === BANK_TRANSFER_PROVIDER_ID;
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
      unsuccessfulOrderCount: input.signals
        ? input.signals.unsuccessful_closed_order_count
        : null,
      hasOtherOpenOrder: input.signals
        ? input.signals.has_other_open_order
        : null,
    },
    dispatchPreview: input.dispatchPreview ?? null,
    billingAddress: billing,
    shippingAddress: delivery,
    shipping,
    lines,
    totals: {
      subtotal: lines.reduce((sum, line) => sum + line.total, 0),
      discount: Number(order.discount_total ?? 0),
      shipping: Number(order.shipping_total ?? 0),
      codFee: feeTotal,
      credits: orderCreditsOf(order),
      total,
    },
    payment,
    invoiceNumber: facts.invoiceNumber,
    invoice: facts.invoice,
    deliveryNote: input.deliveryNote ?? null,
    bankTransfer,
    proforma: input.proforma ?? null,
    transferReceipt: input.transferReceipt ?? null,
    externalInvoice: input.externalInvoice ?? null,
    parcel: facts.parcel,
    cardPayment: cardPaymentOf(input.orderPayment ?? null, code, now),
    manualRefund: manualRefundOf(
      order.metadata,
      outstandingCapturedOf(order.payment_collections),
    ),
    osCustomer: input.osCustomer ?? null,
    internalNote: input.internalNote ?? null,
    notes: notesOf(order.metadata),
    notesEdit: notesEditOf({
      status: code,
      parcel: facts.parcel,
      hasPoint: !!shipping.pickupPoint,
      storePickup: shipping.storePickup,
    }),
    methodEdit: methodEditOf({
      status: code,
      invoice: facts.invoice,
      parcel: facts.parcel,
      storePickup: shipping.storePickup,
    }),
    pointEdit: pointEditOf({
      status: code,
      parcel: facts.parcel,
      hasPoint: !!shipping.pickupPoint,
    }),
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
    // a bontás az eredeti tételeit csökkenti: a tételek határa az övé is
    splitEdit: (() => {
      const reason = lineEditRefusal({
        status: code,
        invoice: facts.invoice,
        parcel: facts.parcel,
      });
      return { allowed: reason === null, reason };
    })(),
    transferSwitch: transferSwitchOf({
      bankTransfer,
      status: code,
      paymentMethod: payment?.method ?? null,
      paymentState: payment?.state ?? null,
      invoice: facts.invoice,
      related: !!related,
    }),
    split: input.split ?? { from: null, into: [] },
    steps: stepsOf(
      code,
      shipping.storePickup,
      facts,
      payment?.method === "Stripe",
      bankTransfer,
    ),
    relatedOrder: related
      ? { ...related, displayId: input.relatedDisplayId }
      : null,
    history: historyOf(status),
  };
}
