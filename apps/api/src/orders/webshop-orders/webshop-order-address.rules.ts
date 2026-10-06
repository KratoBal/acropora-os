import type {
  WebshopOrderAddressInput,
  WebshopOrderDetail,
  WebshopOrderStatus,
} from "@acropora/types";

import type { MedusaOrderAddressRow } from "../../integrations/medusa/medusa-admin.client.js";

/**
 * A CÍMEK SZERKESZTÉSE AZ ADATLAPRÓL (a Figma 494:386 ceruzái; acrobot 26502).
 * A webshop beépített rendelés-frissítésén megy, commerce végpont nélkül.
 *
 * A SZÁMLÁZÁSI CÍM a kiállított számlán rögzítve van: utána csak sztornóval
 * változhat. A SZÁLLÍTÁSI CÍM a feladott csomagon áll: utána a csomagot kell
 * lemondani. Lezárt rendelésen egyik sem szerkeszthető.
 */
const CLOSED: readonly (WebshopOrderStatus | null)[] = [
  "closed",
  "closed_unsuccessfully",
];

export function addressEditOf(input: {
  status: WebshopOrderStatus | null;
  invoice: WebshopOrderDetail["invoice"];
  parcel: WebshopOrderDetail["parcel"];
}): WebshopOrderDetail["addressEdit"] {
  const closed = CLOSED.includes(input.status)
    ? "Lezárt rendelés címe nem szerkeszthető."
    : null;
  const billing =
    closed ??
    (input.invoice?.status === "ISSUED" || input.invoice?.status === "ISSUING"
      ? "A számla már ki van állítva ezzel a címmel: a cím csak a számla sztornója után változhat."
      : null);
  const shipping =
    closed ??
    (input.parcel
      ? "A csomag már fel van adva erre a címre: a cím csak a csomag lemondása után változhat."
      : input.status === "out_for_delivery"
        ? "A rendelés már kiszállítás alatt van."
        : null);
  return {
    billing: { allowed: billing === null, reason: billing },
    shipping: { allowed: shipping === null, reason: shipping },
  };
}

const clean = (value: string | null | undefined) => value?.trim() || null;

/**
 * A webshopnak menő cím. A számlázási cím metaadatát MEGŐRIZZÜK, csak az
 * adószámot írjuk (`tax_id`): a többi kulcs a webshopé.
 */
export function addressPayloadOf(
  input: WebshopOrderAddressInput,
  current: MedusaOrderAddressRow | null | undefined,
): MedusaOrderAddressRow {
  const base: MedusaOrderAddressRow = {
    first_name: clean(input.firstName),
    last_name: clean(input.lastName),
    company: clean(input.company),
    address_1: clean(input.line1),
    address_2: clean(input.line2),
    city: clean(input.city),
    postal_code: clean(input.postalCode),
    country_code: (clean(input.countryCode) ?? "hu").toLowerCase(),
    phone: clean(input.phone),
  };
  if (input.kind !== "billing") return base;
  return {
    ...base,
    metadata: { ...(current?.metadata ?? {}), tax_id: clean(input.taxNumber) },
  };
}
