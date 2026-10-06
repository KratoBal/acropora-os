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

/**
 * A CSOMAGPONT CSERÉJE (commerce #494). A webshop a saját oldalán is tilt
 * (lezárt, törölt, bolti alrendelés, már teljesített), de az OS-csomagot nem
 * látja: a feladott csomag a régi pontra szól, azt csak az OS tudja.
 */
export function pointEditOf(input: {
  status: WebshopOrderStatus | null;
  parcel: WebshopOrderDetail["parcel"];
  hasPoint: boolean;
}): WebshopOrderDetail["pointEdit"] {
  const reason = CLOSED.includes(input.status)
    ? "Lezárt rendelés csomagpontja nem cserélhető."
    : !input.hasPoint
      ? "Ez a rendelés nem csomagpontra megy."
      : input.parcel
        ? "A csomag már fel van adva erre a pontra: a pont csak a csomag lemondása után cserélhető."
        : input.status === "out_for_delivery"
          ? "A rendelés már kiszállítás alatt van."
          : null;
  return { allowed: reason === null, reason };
}

/**
 * A KÉT MEGJEGYZÉS (commerce #493). A vevőé lezárásig írható. A szállítóé
 * csak házhoz szállításnál értelmes (a pénztár csomagpontnál és bolti
 * átvételnél törli), és a feladott csomag címkéjén már rajta van.
 */
export function notesEditOf(input: {
  status: WebshopOrderStatus | null;
  parcel: WebshopOrderDetail["parcel"];
  hasPoint: boolean;
  storePickup: boolean;
}): WebshopOrderDetail["notesEdit"] {
  const closed = CLOSED.includes(input.status)
    ? "Lezárt rendelés megjegyzése nem szerkeszthető."
    : null;
  const carrier =
    closed ??
    (input.storePickup
      ? "Bolti átvételnél nincs szállító."
      : input.hasPoint
        ? "Csomagpontra menő csomagnál a futár nem kap üzenetet."
        : input.parcel
          ? "A csomag már fel van adva: a szállítónak szóló üzenet a címkén áll."
          : null);
  return {
    customer: { allowed: closed === null, reason: closed },
    carrier: { allowed: carrier === null, reason: carrier },
  };
}

/** A két megjegyzés a rendelés metaadatáról (commerce #493 kulcsai). */
export function notesOf(
  metadata: Record<string, unknown> | null | undefined,
): WebshopOrderDetail["notes"] {
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  return {
    customer: text(metadata?.acropora_customer_note),
    carrier: text(metadata?.acropora_carrier_note),
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
