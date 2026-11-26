import type { BillingDocumentRow } from "./billing-documents.repository.js";

/**
 * Egy bizonylat tételei vázlat-bemenetként. Csak a tételek: a kedvezmény-sort
 * a normalizálás a tétel százalékából újraépíti, egyszer. A díjbekérő -> előlegszámla, a kiállított -> másolat és a végszámla
 * (díjbekérő sorai) ezt használja; külön modulban, hogy a forrás-sortól az XML tételig menő teszt (L8) a szolgáltatás nélkül hívja.
 */
export function draftLinesOf(row: BillingDocumentRow) {
  return row.lines
    .filter((line) => line.kind === "ITEM")
    .map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      // a díjbekérő -> előleg -> végszámla lánc a szerződés-tételt is viszi
      contractItemId: line.contractItemId,
      description: line.description,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitNet: line.unitNet.toString(),
      vatRatePercent: line.vatRatePercent.toString(),
      discountPercent: line.discountPercent?.toString() ?? null,
      comment: line.comment,
    }));
}
