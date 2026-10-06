import { Prisma } from "@acropora/database";

import { addSurcharge } from "../integrations/medusa/medusa-price-source.js";
import { SUPPORTED_CURRENCY } from "../integrations/medusa/medusa-pricing.policy.js";

/**
 * A GAZDA-ÁTVÉTEL VISZI AZ ÁRAT (kártya fc5fb5f9; Balázs „b” döntése,
 * 2026-09-04, emlék 1416: „a saját ár akkor lép be, amikor az adott
 * terméknél átvesszük a gazdaságot”; acrobot 27251).
 *
 * A `ProductVariant.sellingGrossPrice` mezőt eddig semmi nem írta, és a
 * vetítés ACROPORA gazdánál CSAK ebből olvas: az átvétel napján minden átvett
 * termék ára `own-price-missing` okkal megállt volna. Az átvétel ezért
 * ugyanabban a tranzakcióban átmásolja a tükör árát, változatonként:
 *
 *   - CSAK az üres mezőbe: meglévő saját árat nem ír felül;
 *   - a LISTAÁRAT (`grossPrice` + a változat UNAS-felára), NEM a futó akciós
 *     árat. Az akciós ár a saját mezőben örök akcióvá válna. A következmény,
 *     kimondva: ha átvételkor akció fut, az az átvétellel megszűnik, mert az
 *     OS-nek ma nincs saját akciós ára;
 *   - a pénznem forint, ha a tükör nem mond mást: a tükör ma soha nem hordoz
 *     pénznemet (mérve 2026-09-04, `medusa-price-source.ts`), és az adatbázis
 *     csak a kettőt EGYÜTT fogadja el.
 *
 * Ami nem másolható, az nem hiba, hanem a naplóba írt ok: a tükör-sor vagy a
 * tükör ára hiányzik. Ilyenkor a vetítés az átvétel után ugyanúgy megáll,
 * mint eddig, de most a napló megmondja, miért.
 */
export type TakeoverPriceVariant = {
  id: string;
  sku: string;
  sellingGrossPrice: Prisma.Decimal | null;
  unasVariantExtraGrossPrice: Prisma.Decimal | null;
};

export type TakeoverPriceMirror = {
  grossPrice: Prisma.Decimal | null;
  currency: string | null;
} | null;

export type TakeoverPriceStep =
  | {
      kind: "copy";
      variantId: string;
      sku: string;
      sellingGrossPrice: Prisma.Decimal;
      sellingPriceCurrency: string;
    }
  | {
      kind: "skip";
      variantId: string;
      sku: string;
      reason: "own-price-set" | "mirror-row-missing" | "mirror-price-missing";
    };

export function takeoverPriceSteps(
  variants: readonly TakeoverPriceVariant[],
  mirror: TakeoverPriceMirror,
): TakeoverPriceStep[] {
  return variants.map((variant) => {
    const base = { variantId: variant.id, sku: variant.sku };
    if (variant.sellingGrossPrice !== null)
      return { kind: "skip", ...base, reason: "own-price-set" };
    if (mirror === null)
      return { kind: "skip", ...base, reason: "mirror-row-missing" };
    const gross = addSurcharge(
      mirror.grossPrice,
      variant.unasVariantExtraGrossPrice,
    );
    if (gross === null)
      return { kind: "skip", ...base, reason: "mirror-price-missing" };
    return {
      kind: "copy",
      ...base,
      sellingGrossPrice: gross,
      sellingPriceCurrency: mirror.currency ?? SUPPORTED_CURRENCY,
    };
  });
}

/** A napló sora: mi lett a változatok árával az átvételkor. */
export function takeoverPriceLog(
  steps: readonly TakeoverPriceStep[],
): Prisma.JsonObject {
  return {
    source: "unas-mirror-list-price",
    copied: steps.flatMap((step) =>
      step.kind === "copy"
        ? [
            {
              variantId: step.variantId,
              sku: step.sku,
              sellingGrossPrice: step.sellingGrossPrice.toFixed(4),
              sellingPriceCurrency: step.sellingPriceCurrency,
            },
          ]
        : [],
    ),
    skipped: steps.flatMap((step) =>
      step.kind === "skip"
        ? [{ variantId: step.variantId, sku: step.sku, reason: step.reason }]
        : [],
    ),
  };
}
