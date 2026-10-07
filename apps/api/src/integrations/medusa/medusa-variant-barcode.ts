import type { ProductBarcodeType } from "@acropora/database";

import { barcodeType, isProductGtin } from "../../products/barcode-type.js";
import {
  decideMedusaBarcode,
  type MedusaBarcodeDecision,
} from "./medusa-barcode.policy.js";

/**
 * A VÁLTOZATOK VONALKÓDJA A `ProductBarcode`-BÓL (SEO P0 PR 4, D1).
 *
 * Eddig a vetítés a változat gyártói cikkszámából vitte a vonalkódot, csak a
 * létrehozáskor, és csak egyváltozatos terméknél: a gyártói cikkszám TERMÉK-szintű
 * érték, minden változat-sorra ugyanaz jönne, és a bolt mezői egyediek. A
 * `ProductBarcode` változatonként külön sor, tehát ez a tiltás itt nem áll.
 *
 * A DÖNTÉS UGYANAZ, mint eddig (`decideMedusaBarcode`): a mező a hosszból (13 jegy
 * `ean`, 12 jegy `upc`), az ismétlődő, a kiadvány- és a tiltott kód nem megy ki.
 * Csak termék-GTIN típusú primary sor jön szóba; a típus nélküli (még nem
 * backfillelt) sort a `barcodeType` sorolja be, ugyanúgy, ahogy a backfill fogja.
 *
 * Tiszta függvény: a lekérdezés (a sorok, az ismétlődés-szám, a tiltó-lista) a
 * futtatóban van.
 */
export interface VariantBarcodeDecision {
  sku: string;
  code: string;
  decision: MedusaBarcodeDecision;
}

export function decideVariantBarcodes(input: {
  variants: readonly { id: string; sku: string }[];
  primaries: readonly {
    variantId: string;
    code: string;
    type: ProductBarcodeType | null;
  }[];
  sameValueCount(code: string): number;
  blocked(sku: string, code: string): boolean;
}): VariantBarcodeDecision[] {
  const out: VariantBarcodeDecision[] = [];
  for (const v of input.variants) {
    const sor = input.primaries.find((p) => p.variantId === v.id);
    if (!sor) continue;
    if (!isProductGtin(sor.type ?? barcodeType(sor.code))) continue;
    out.push({
      sku: v.sku,
      code: sor.code,
      decision: decideMedusaBarcode(
        sor.code,
        input.sameValueCount(sor.code),
        input.blocked(v.sku, sor.code),
      ),
    });
  }
  return out;
}

/** A kapcsoló (C3, „Vetítés” 6.): alapból be, `false` a mai, gyártói cikkszám szerinti út. */
export const barcodesFromProductBarcode = (
  env: Record<string, string | undefined>,
): boolean => env.MEDUSA_PROJECT_BARCODES !== "false";
