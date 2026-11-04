import { Prisma } from "@acropora/database";

import {
  CERTIFICATE_MONEY_SCALE,
  computeCertificateLineAmounts,
  wholeForintCertificateAmounts,
} from "./completion-certificate-amounts.js";

/**
 * A MEGRENDELÉS TIG-JÉNEK SORAI (Megrendelések S2) -- TISZTA TERV, adatbázis nélkül.
 *
 * A megrendelés tételei az elfogadott ajánlat-verzió tételei (murena, S1:
 * `selectOrderItems`); egy megrendeléshez több TIG is készülhet, tételenként
 * vagy mennyiségre részben (Luca kérése). Ez a modul mondja meg egy kiállítási
 * kérésből, mi kerül a TIG soraiba, és mi a hátralévő.
 *
 * === A HÁTRALÉVŐ SZÁMOLT, NEM TÁROLT ===
 *
 * Hátralévő = a tétel mennyisége mínusz az eddigi TIG-sorok mennyisége
 * ugyanarra a tételre (`quoteItemId`). Egy tárolt "teljesített" szám a TIG-ek
 * mellett egy második igazság lenne, és elcsúszhatna.
 *
 * === A LEZÁRÓ RÉSZ NETTÓJA (acrobot döntése, 42206) ===
 *
 * A TIG (és a számla) soronként egész forintra kerekít. Ha egy tétel több
 * részletben megy, a kerekített részek összege 1 Ft-tal eltérhetne az ajánlat
 * sorától. Ezért a tételt LEZÁRÓ rész (ami a teljes hátralévőt igazolja) nettója
 * = az ajánlat sorának kerekített nettója mínusz az eddig igazolt kerekített
 * nettó, és az egységára ebből visszaszámolt (négy tizedesre): a soronkénti
 * kerekítés ezt pontosan visszaadja, így a TIG-ek végösszege forintra egyezik
 * az ajánlattal. A nem lezáró rész az ajánlat egységárával megy.
 */

export interface OrderLineInput {
  quoteItemId: string;
  name: string;
  quantity: Prisma.Decimal;
  unit: string;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
}

export interface CertifiedLineInput {
  quoteItemId: string;
  quantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
}

export interface CertificateLineRequest {
  quoteItemId: string;
  /** szövegként, mint a mennyiség minden bevitele (a JSON-szám kerekíthetne) */
  quantity: string;
}

export interface PlannedCertificateLine {
  quoteItemId: string;
  description: string;
  quantity: Prisma.Decimal;
  quantityUnit: string;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
  /** a tétel teljes hátralévőjét igazolja (a nettója az egyenlegből jön) */
  closing: boolean;
}

export type CertificatePlanError =
  | { code: "NO_LINES" }
  | { code: "UNKNOWN_ITEM"; quoteItemId: string }
  | { code: "DUPLICATE_ITEM"; name: string }
  | { code: "INVALID_QUANTITY"; name: string }
  | {
      code: "OVER_REMAINING";
      name: string;
      requested: string;
      remaining: string;
    }
  | { code: "NOTHING_REMAINING" };

export type CertificatePlan =
  | { ok: true; lines: PlannedCertificateLine[] }
  | { ok: false; error: CertificatePlanError };

/** A mennyiség alakja: pozitív, legfeljebb hat tizedes (a séma `Decimal(19, 6)`-ja). */
const QUANTITY = /^\d{1,13}(?:[.,]\d{1,6})?$/;

const lineNet = (quantity: Prisma.Decimal, unitNet: Prisma.Decimal) =>
  wholeForintCertificateAmounts(
    computeCertificateLineAmounts({
      quantity,
      unitPrice: unitNet,
      vatRatePercent: 0,
    }),
    0,
  ).netAmount;

/** Tételenként a hátralévő mennyiség (negatív sosem: a kapu nem enged túl). */
export function remainingByItem(
  order: readonly OrderLineInput[],
  certified: readonly CertifiedLineInput[],
): Map<string, Prisma.Decimal> {
  const remaining = new Map(
    order.map((line) => [line.quoteItemId, line.quantity]),
  );
  for (const line of certified) {
    const left = remaining.get(line.quoteItemId);
    if (left !== undefined)
      remaining.set(line.quoteItemId, left.minus(line.quantity));
  }
  return remaining;
}

/**
 * A KIÁLLÍTÁS TERVE. Kérés nélkül (`request` üres vagy hiányzik) minden tétel a
 * teljes hátralévőjével megy, a már teljesített tétel kimarad; kéréssel csak a
 * kért tételek, a kért mennyiséggel, ami nem lehet több a hátralévőnél.
 */
export function planPartnerOrderCertificate(input: {
  order: readonly OrderLineInput[];
  certified: readonly CertifiedLineInput[];
  request?: readonly CertificateLineRequest[];
}): CertificatePlan {
  const fail = (error: CertificatePlanError): CertificatePlan => ({
    ok: false,
    error,
  });
  const remaining = remainingByItem(input.order, input.certified);
  const byId = new Map(input.order.map((line) => [line.quoteItemId, line]));

  const wanted: { line: OrderLineInput; quantity: Prisma.Decimal }[] = [];
  if (!input.request?.length) {
    for (const line of input.order) {
      const left = remaining.get(line.quoteItemId)!;
      if (left.greaterThan(0)) wanted.push({ line, quantity: left });
    }
    if (!wanted.length) return fail({ code: "NOTHING_REMAINING" });
  } else {
    const seen = new Set<string>();
    for (const request of input.request) {
      const line = byId.get(request.quoteItemId);
      if (!line)
        return fail({ code: "UNKNOWN_ITEM", quoteItemId: request.quoteItemId });
      if (seen.has(line.quoteItemId))
        return fail({ code: "DUPLICATE_ITEM", name: line.name });
      seen.add(line.quoteItemId);
      const text = request.quantity.trim();
      if (!QUANTITY.test(text))
        return fail({ code: "INVALID_QUANTITY", name: line.name });
      const quantity = new Prisma.Decimal(text.replace(",", "."));
      if (!quantity.greaterThan(0))
        return fail({ code: "INVALID_QUANTITY", name: line.name });
      const left = remaining.get(line.quoteItemId)!;
      if (quantity.greaterThan(left))
        return fail({
          code: "OVER_REMAINING",
          name: line.name,
          requested: quantity.toString(),
          remaining: left.toString(),
        });
      wanted.push({ line, quantity });
    }
    if (!wanted.length) return fail({ code: "NO_LINES" });
  }

  return {
    ok: true,
    lines: wanted.map(({ line, quantity }) => {
      const closing = quantity.equals(remaining.get(line.quoteItemId)!);
      const base = {
        quoteItemId: line.quoteItemId,
        description: line.name,
        quantity,
        quantityUnit: line.unit,
        vatRatePercent: line.vatRatePercent,
        closing,
      };
      if (!closing) return { ...base, unitNet: line.unitNet };
      const alreadyNet = input.certified
        .filter((c) => c.quoteItemId === line.quoteItemId)
        .reduce(
          (sum, c) => sum.plus(lineNet(c.quantity, c.unitNet)),
          new Prisma.Decimal(0),
        );
      const target = lineNet(line.quantity, line.unitNet).minus(alreadyNet);
      return {
        ...base,
        unitNet: target
          .div(quantity)
          .toDecimalPlaces(
            CERTIFICATE_MONEY_SCALE,
            Prisma.Decimal.ROUND_HALF_UP,
          ),
      };
    }),
  };
}
