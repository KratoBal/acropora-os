import type { WebshopPaymentRole } from "./webshop-mail.js";

/**
 * A WEBSHOP SZÁLLÍTÁSI DÍJAI ÉS A FIZETÉSI MÓDOK SZÁLLÍTÁSI MÓDONKÉNT (kártya e0e2378b; Balázs, 2026-08-31 és 2026-09-01).
 * A webshopban mindkettő megvan (commerce `commerce-settings` és `shipping-payment-rules`, #802, #804); ez az OS felülete
 * hozzájuk. A szerepek és a lehetetlen párok a webshopéval egyeznek: az ott a döntő ellenőrzés, ez az űrlapé, hogy a hiba
 * már a mentés előtt látsszon.
 */

/** A webshop szállítási módjai, abban a sorrendben, ahogy a lap mutatja. */
export const WEBSHOP_SHIPPING_ROLES = [
  "PICKUP",
  "GLS_NORMAL",
  "GLS_HEAVY",
  "FOXPOST",
] as const;
export type WebshopShippingRole = (typeof WEBSHOP_SHIPPING_ROLES)[number];

export const WEBSHOP_SHIPPING_ROLE_LABELS: Record<WebshopShippingRole, string> =
  {
    PICKUP: "Személyes átvétel az üzletben",
    GLS_NORMAL: "GLS házhozszállítás és csomagpont",
    GLS_HEAVY: "GLS nehézáru",
    FOXPOST: "Foxpost csomagautomata",
  };

/** The payment roles of the web shop (the same union as the shop's letters use, `webshop-mail.ts`). */
export const WEBSHOP_PAYMENT_ROLES = [
  "ONLINE_CARD",
  "COD",
  "PAY_AT_STORE",
  "BANK_TRANSFER",
] as const satisfies readonly WebshopPaymentRole[];

export const WEBSHOP_PAYMENT_ROLE_LABELS: Record<WebshopPaymentRole, string> = {
  ONLINE_CARD: "Online bankkártya",
  COD: "Utánvét",
  PAY_AT_STORE: "Fizetés az üzletben (készpénz vagy kártya)",
  BANK_TRANSFER: "Előre utalás",
};

/** Szállítási módonként a fizetési módok, abban a sorrendben, ahogy a vevő a pénztárban látja. */
export type WebshopPaymentMatrix = Record<
  WebshopShippingRole,
  WebshopPaymentRole[]
>;

/** A hat forint-érték, a webshop kulcsaival összekötve (a kulcs a webshop `commerce-settings` kulcsa). */
export const WEBSHOP_SHIPPING_FEES = [
  {
    field: "glsNormal",
    key: "shipping_gls_normal_huf",
    label: "GLS házhozszállítás és csomagpont díja",
  },
  {
    field: "glsHeavy",
    key: "shipping_gls_heavy_huf",
    label: "GLS nehézáru díja",
  },
  {
    field: "foxpost",
    key: "shipping_foxpost_huf",
    label: "Foxpost díja",
  },
  {
    field: "freeThresholdGls",
    key: "free_shipping_threshold_gls_huf",
    label:
      "Ingyenes GLS szállítás ettől az áruértéktől (a nehézáru nem ingyenes)",
  },
  {
    field: "freeThresholdFoxpost",
    key: "free_shipping_threshold_foxpost_huf",
    label: "Ingyenes Foxpost szállítás ettől az áruértéktől",
  },
  {
    field: "cashOnDeliveryFee",
    key: "cash_on_delivery_fee_huf",
    label: "Utánvét kezelési díja (rendelésenként egyszer)",
  },
] as const;
export type WebshopShippingFeeField =
  (typeof WEBSHOP_SHIPPING_FEES)[number]["field"];

/** Forintban; `null`, ha a webshopban nincs beállítva és alapértéke sincs. */
export type WebshopShippingFees = Record<
  WebshopShippingFeeField,
  number | null
>;

export type WebshopShippingSettings = {
  fees: WebshopShippingFees;
  /** A mezők, amelyeknél a webshop a saját alapértékét használja (nincs tárolt sor). */
  defaultFees: WebshopShippingFeeField[];
  matrix: WebshopPaymentMatrix;
  /**
   * Fizetési módok, amelyeket a webshop visszaadott, de ez az OS még nem ismer (a webshop új módot kapott). A mátrix nélkülük
   * látszik, és a mentése áll: a teljes mátrix visszaírása ezeket csendben törölné (barracuda, #2729).
   */
  unknownPayments: string[];
};

/** Ésszerű felső határ egy díjra vagy küszöbre: egy elgépelt nulla ne zárja ki az ingyenes szállítást. */
export const WEBSHOP_SHIPPING_FEE_MAX = 1_000_000;

export type WebshopShippingFeesParse =
  | { ok: true; value: Record<WebshopShippingFeeField, number> }
  | { ok: false; errors: Record<string, string> };

/** Ugyanaz a szabály az űrlapon és az API-ban: mind a hat érték megadva, egész, nem negatív forint. */
export function parseWebshopShippingFeesInput(
  raw: unknown,
): WebshopShippingFeesParse {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const value = {} as Record<WebshopShippingFeeField, number>;
  for (const { field } of WEBSHOP_SHIPPING_FEES) {
    const amount = input[field];
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < 0 ||
      amount > WEBSHOP_SHIPPING_FEE_MAX
    )
      errors[field] = "Egész forint 0 és 1 000 000 között.";
    else value[field] = amount;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * PÁROK, AMELYEK NEM MŰKÖDHETNEK, akármit akar az üzlet (a webshop `shipping-payment-rules/rules.ts` szabálya): utánvét
 * személyes átvételnél (nincs kiszállítás), és fizetés az üzletben futárnál vagy csomagpontnál (a vevő nem jön be).
 */
export function impossiblePaymentReason(
  shipping: WebshopShippingRole,
  payment: WebshopPaymentRole,
): string | null {
  if (shipping === "PICKUP" && payment === "COD")
    return "Személyes átvételnél nincs utánvét: nincs kiszállítás, amin fizetni lehetne.";
  if (shipping !== "PICKUP" && payment === "PAY_AT_STORE")
    return "Futáros vagy csomagpontos szállításnál nincs fizetés az üzletben: a vevő nem jön be.";
  return null;
}

export type WebshopPaymentMatrixParse =
  | { ok: true; value: WebshopPaymentMatrix }
  | { ok: false; errors: Record<string, string> };

/** A teljes mátrix: minden szállítási mód, mindegyiknél legalább egy fizetési mód, ismétlés és lehetetlen pár nélkül. */
export function parseWebshopPaymentMatrixInput(
  raw: unknown,
): WebshopPaymentMatrixParse {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const value = {} as WebshopPaymentMatrix;
  for (const shipping of WEBSHOP_SHIPPING_ROLES) {
    const list = input[shipping];
    if (
      !Array.isArray(list) ||
      !list.every((p): p is WebshopPaymentRole =>
        (WEBSHOP_PAYMENT_ROLES as readonly unknown[]).includes(p),
      )
    ) {
      errors[shipping] = "Ismeretlen fizetési mód a listában.";
      continue;
    }
    if (!list.length) {
      errors[shipping] =
        "Legalább egy fizetési mód kell: üres listával a pénztár ennél a szállítási módnál semmit nem kínálna.";
      continue;
    }
    if (new Set(list).size !== list.length) {
      errors[shipping] = "Egy fizetési mód kétszer szerepel.";
      continue;
    }
    const impossible = list
      .map((payment) => impossiblePaymentReason(shipping, payment))
      .find(Boolean);
    if (impossible) {
      errors[shipping] = impossible;
      continue;
    }
    value[shipping] = [...list];
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}
