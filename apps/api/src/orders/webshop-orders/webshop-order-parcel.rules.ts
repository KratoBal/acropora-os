import type {
  WebshopOrderParcel,
  WebshopOrderStatus,
  WebshopParcelSize,
} from "@acropora/types";

import { trackingUrlFor } from "../../integrations/carriers/tracking-url.js";
import type {
  CarrierCode,
  ParcelDestination,
} from "../../integrations/carriers/carrier.types.js";
import type { WebshopParcelView } from "../../integrations/carriers/webshop-parcel.service.js";
import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import { shippingOf } from "./webshop-order-detail.rules.js";

/**
 * A WEBSHOP RENDELÉS CSOMAGJA, hálózat nélkül (Rendelések, 5. PR): mikor
 * adható fel, kinek és hová, és mennyi az utánvét. A létrehozás murena
 * szolgáltatása (`WebshopParcelService`, #1469), a duplikáció-védelemmel.
 */

/** Ezekben az állapotokban adható fel csomag: visszaigazolás után, lezárás előtt. */
const PARCEL_STATUSES: readonly WebshopOrderStatus[] = [
  "confirmed",
  "stocking",
  "out_for_delivery",
];

export function parcelRefusal(input: {
  status: WebshopOrderStatus | null;
  storePickup: boolean;
  carrier: "FOXPOST" | "GLS" | null;
  invoiceIssued: boolean;
}): string | null {
  if (input.storePickup)
    return "Bolti átvételes rendeléshez nem adunk fel csomagot.";
  if (!input.status || !PARCEL_STATUSES.includes(input.status))
    return "Csomag a visszaigazolt, még le nem zárt rendeléshez adható fel.";
  if (!input.invoiceIssued) return "Előbb állítsd ki a számlát.";
  if (!input.carrier)
    return "A rendelés szállítási módjából nem derül ki a szállító (Foxpost vagy GLS).";
  return null;
}

const clean = (value: string | null | undefined) => value?.trim() || null;

/** A név magyar sorrendben, ahogy az adatlapon és a számlán. */
const nameOf = (
  address: MedusaOrderDetailRow["shipping_address"] | undefined,
) =>
  [address?.last_name, address?.first_name]
    .map(clean)
    .filter(Boolean)
    .join(" ") || null;

export type ParcelInput =
  | {
      ok: true;
      carrier: CarrierCode;
      recipient: { name: string; phone: string; email: string };
      destination: ParcelDestination;
      codHuf?: number;
    }
  | { ok: false; message: string };

/**
 * A SZÁLLÍTÓNAK MENŐ ADATOK A RENDELÉSBŐL. A címzett a szállítási cím neve és
 * telefonja (ha nincs, a számlázásié); csomagpontnál a pont azonosítója,
 * házhoz szállításnál a szállítási cím. Ami hiányzik, azt itt mondjuk ki, nem
 * a szállító angol hibájából.
 *
 * AZ UTÁNVÉT a rendelés végösszege egész forintban, csak utánvétes fizetésnél.
 */
export function parcelInputOf(order: MedusaOrderDetailRow): ParcelInput {
  const shipping = shippingOf(order.shipping_methods ?? []);
  if (!shipping.carrier)
    return {
      ok: false,
      message:
        "A rendelés szállítási módjából nem derül ki a szállító (Foxpost vagy GLS).",
    };
  const delivery = order.shipping_address;
  const billing = order.billing_address;
  const name = nameOf(delivery) ?? nameOf(billing);
  const phone = clean(delivery?.phone) ?? clean(billing?.phone);
  const email = clean(order.email);
  const missing = [
    name ? null : "név",
    phone ? null : "telefonszám",
    email ? null : "e-mail cím",
  ].filter(Boolean);
  if (missing.length)
    return {
      ok: false,
      message: `A címzettből hiányzik: ${missing.join(", ")}. A szállító enélkül nem veszi fel a csomagot.`,
    };

  let destination: ParcelDestination;
  if (shipping.pickupPoint) {
    if (!shipping.pickupPoint.id)
      return {
        ok: false,
        message:
          "A rendelés csomagpontjának nincs azonosítója a webshopban, ezért a csomag nem adható fel.",
      };
    destination = { kind: "point", pointId: shipping.pickupPoint.id };
  } else {
    const zip = clean(delivery?.postal_code);
    const city = clean(delivery?.city);
    const address = [delivery?.address_1, delivery?.address_2]
      .map(clean)
      .filter(Boolean)
      .join(" ");
    if (!zip || !city || !address)
      return {
        ok: false,
        message:
          "A rendelésen nincs teljes szállítási cím (irányítószám, város, utca), ezért a csomag nem adható fel.",
      };
    destination = { kind: "home", zip, city, address };
  }

  const cod =
    order.payment_collections?.[0]?.payments?.[0]?.provider_id ===
    "pp_acropora_cod";
  return {
    ok: true,
    carrier: shipping.carrier === "FOXPOST" ? "foxpost" : "gls",
    recipient: { name: name!, phone: phone!, email: email! },
    destination,
    ...(cod ? { codHuf: Math.round(Number(order.total)) } : {}),
  };
}

/** A méret csak Foxpostnál megy a szállítónak; a GLS nem kér ilyet. */
export const sizeFor = (
  carrier: CarrierCode,
  size: WebshopParcelSize | undefined,
) => (carrier === "foxpost" ? size : undefined);

/** A csomag az adatlapon. */
export function parcelOf(
  view: WebshopParcelView | undefined,
  env: Record<string, string | undefined> = process.env,
): WebshopOrderParcel | null {
  if (!view) return null;
  return {
    carrier: view.carrier === "foxpost" ? "FOXPOST" : "GLS",
    reference: view.reference,
    parcelNumber: view.parcelNumber,
    stub: view.stub,
    size: view.size,
    codHuf: view.codHuf,
    createdAt: view.createdAt.toISOString(),
    trackingUrl: view.stub
      ? null
      : trackingUrlFor(view.carrier, view.parcelNumber, env),
  };
}
