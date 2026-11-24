import type { WebshopOrderCredit } from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";

/**
 * A RENDELÉS JÓVÁÍRÁSAI (kártya e62a1a64; mérve a teszt OS-en 2026-11-24: egy 400 pontot beváltó rendelésre a számla 422-vel
 * megállt, mert a tételek 41 100 Ft-ot adtak, a végösszeg 40 700 volt, és a rendelés-nézet a pontot nem mutatta).
 *
 * A Medusa a kosárra és a rendelésre `credit_lines` sorokat tesz: a beváltott hűségpont (`reference` `loyalty_points`, a pontok száma a
 * sor metaadatában) és az ajándékkártya (`gift_card`). A `total` ezek UTÁN számolt összeg (az adó után vonódik le), tehát a tételek és a
 * szállítás összege `total + a jóváírások`. Ismeretlen hivatkozású jóváírást NEM találgatunk: `other`-ként jön vissza, és a számla
 * megtagadja, mert nem tudjuk, adóalapot csökkent-e.
 *
 * A KONSTANSOK a webshop (acropora-commerce) `loyalty-credit.ts` és `gift-card-credit.ts` fájljának értékei; ha ott változnak, itt is.
 */
export const LOYALTY_CREDIT_REFERENCE = "loyalty_points";
export const GIFT_CARD_CREDIT_REFERENCE = "gift_card";

const money = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  const raw = value as { numeric?: unknown; value?: unknown };
  return Number(raw.numeric ?? raw.value ?? 0);
};

export function orderCreditsOf(
  order: Pick<MedusaOrderDetailRow, "credit_lines">,
): WebshopOrderCredit[] {
  const credits: WebshopOrderCredit[] = [];
  for (const line of order.credit_lines ?? []) {
    const amount = money(line.amount);
    if (!(amount > 0)) continue;
    if (line.reference === LOYALTY_CREDIT_REFERENCE) {
      const points = Number(line.metadata?.points);
      credits.push({
        id: line.id,
        kind: "loyalty",
        label: "Hűségpont",
        amount,
        points: Number.isInteger(points) && points > 0 ? points : null,
      });
    } else if (line.reference === GIFT_CARD_CREDIT_REFERENCE) {
      credits.push({
        id: line.id,
        kind: "gift_card",
        label: "Ajándékkártya",
        amount,
        points: null,
      });
    } else {
      credits.push({
        id: line.id,
        kind: "other",
        label: line.reference ? `Jóváírás (${line.reference})` : "Jóváírás",
        amount,
        points: null,
      });
    }
  }
  return credits;
}

export const creditTotalOf = (credits: readonly WebshopOrderCredit[]): number =>
  Math.round(credits.reduce((sum, credit) => sum + credit.amount, 0) * 100) /
  100;

/**
 * A HŰSÉGPONT SORÁNAK ALAKJA A SZÁMLÁN (lásd `creditLinesOf` a `webshop-order-invoice.rules.ts`-ben): `payment` (alap, B: fizetés, az ÁFA
 * a teljes árból marad) vagy `discount` (A: árengedmény, az ÁFA-alap csökken). A döntés a könyvelőé és Balázsé; váltáskor ezt az egy
 * környezeti változót kell átírni az OS API-n: `WEBSHOP_LOYALTY_INVOICE_SHAPE=discount`. Bármi más érték vagy a hiánya: lásd `loyaltyInvoiceShapeOf`.
 */
export type LoyaltyInvoiceShape = "payment" | "discount" | "undecided";
export const LOYALTY_INVOICE_SHAPE_ENV = "WEBSHOP_LOYALTY_INVOICE_SHAPE";
/**
 * AZ ALAK ÉLŐ KIÁLLÍTÁSNÁL CSAK KIMONDVA ÉRVÉNYES (barracuda, #2826: a 0 százalékos negatív sor NAV/Számlázz.hu alakja a könyvelő
 * válaszáig nem eldöntött). A teszt-szerveren (álszámlázó, `stub`) és kikapcsolt kiállításnál a beállítás hiánya `payment` (B); ÉLŐ
 * kiállításnál (`live`) a hiánya `undecided`: a beváltott pontos rendelés számlája NEM készül el, amíg valaki ki nem mondja
 * (`WEBSHOP_LOYALTY_INVOICE_SHAPE=payment` vagy `discount`). Így egy nem egyeztetett sor nem kerülhet véletlenül élő számlára.
 */
export const loyaltyInvoiceShapeOf = (
  env: Record<string, string | undefined> = process.env,
  issueMode?: "live" | "stub" | "off" | "conflict",
): LoyaltyInvoiceShape => {
  const value = env[LOYALTY_INVOICE_SHAPE_ENV]?.trim().toLowerCase();
  if (value === "discount") return "discount";
  if (value === "payment") return "payment";
  return issueMode === "live" ? "undecided" : "payment";
};
