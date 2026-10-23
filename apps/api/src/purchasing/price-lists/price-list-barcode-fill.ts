import { randomUUID } from "node:crypto";

import type { Prisma } from "@acropora/database";
import { validateGtin } from "@acropora/jev/product-enrichment";

import { barcodeType, storedBarcodeCode } from "../../products/barcode-type.js";
import { barcodeQueryCodes } from "./price-list-matching.js";

/**
 * VONALKÓD-PÓTLÁS A JÓVÁHAGYOTT PÁRNÁL (task arlista-vonalkod-potlas; Balázs
 * 2026-10-23 20:10 UTC, acrobot 35822: „csak jóváhagyott párnál, naplózva, a
 * ProductBarcode táblán át, a meglévő vonalkódot nem írja felül").
 *
 * Amikor egy ember jóváhagy egy névből javasolt párt, és a beszállító listájának
 * sorában van vonalkód, a mi változatunk pedig EGYETLEN vonalkóddal sem rendelkezik,
 * a beszállító vonalkódja a változaté lesz. Így a következő feltöltésnél a vonalkód
 * már magától köt. Az eredmény minden esetben megnevezett ok, a naplóba kerül.
 *
 * Mikor NEM ír (és miért):
 *  - NO_BARCODE: a listasornak nincs vonalkódja;
 *  - INVALID: a kód nem érvényes termék-GTIN (hossz, ellenőrző számjegy) vagy bolti
 *    tartományú saját szám: egy hibás kódot nem viszünk a törzsbe;
 *  - VARIANT_HAS_BARCODE: a változatnak már van vonalkódja; azt nem írjuk felül, és
 *    egy másodikat sem teszünk mellé találgatásból;
 *  - OWNED_BY_OTHER: a kódot (bármelyik írásmódját) már másik változat birtokolja.
 */
export type BarcodeFillOutcome =
  "ADDED" | "NO_BARCODE" | "INVALID" | "VARIANT_HAS_BARCODE" | "OWNED_BY_OTHER";

export async function fillBarcodeFromPair(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    suggestionId: string;
    supplierId: string;
    supplierSku: string;
    variantId: string;
  },
): Promise<BarcodeFillOutcome> {
  // the supplier's latest row for this sku that carries a barcode
  const entry = await transaction.supplierPriceListEntry.findFirst({
    where: {
      supplierSku: input.supplierSku,
      gtin: { not: null },
      list: { supplierId: input.supplierId },
    },
    orderBy: [{ list: { listDate: "desc" } }, { id: "desc" }],
    select: { gtin: true },
  });
  if (!entry?.gtin) return "NO_BARCODE";

  const code = storedBarcodeCode(entry.gtin);
  const checked = validateGtin(code);
  if (!checked.ok || checked.restrictedCirculation) return "INVALID";

  if (
    (await transaction.productBarcode.count({
      where: { variantId: input.variantId },
    })) > 0
  )
    return "VARIANT_HAS_BARCODE";

  const owned = await transaction.productBarcode.findFirst({
    where: { code: { in: barcodeQueryCodes(entry.gtin) } },
    select: { id: true },
  });
  if (owned) return "OWNED_BY_OTHER";

  // createMany with skipDuplicates, not create: a concurrent approval that took the
  // same code must end as OWNED_BY_OTHER, not as a unique-violation error that
  // would roll back the whole approval
  const id = randomUUID();
  const { count } = await transaction.productBarcode.createMany({
    data: [
      {
        id,
        variantId: input.variantId,
        code,
        // the variant's first barcode is its primary one
        isPrimary: true,
        type: barcodeType(code),
        source: "SUPPLIER_PRICE_LIST",
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) return "OWNED_BY_OTHER";
  await transaction.auditLog.create({
    data: {
      userId: input.userId,
      action: "product-barcode.added-from-price-list",
      entityType: "ProductBarcode",
      entityId: id,
      metadata: {
        variantId: input.variantId,
        code,
        supplierId: input.supplierId,
        supplierSku: input.supplierSku,
        suggestionId: input.suggestionId,
      },
    },
  });
  return "ADDED";
}
