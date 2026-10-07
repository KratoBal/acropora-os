import type { ProductBarcodeType } from "@acropora/database";

import {
  decideMedusaBarcode,
  vonalkodAlakjai,
} from "../integrations/medusa/medusa-barcode.policy.js";
import { barcodeType } from "./barcode-type.js";

/**
 * A VONALKÓD-BACKFILL TERVE (SEO P0 PR 4, a terv 4. része; D1, D2). Tiszta függvény:
 * a sorokból tervet készít, írni a CLI ír, és csak `--apply` mellett.
 *
 * KÉT RÉSZE VAN:
 *
 * 1. A meglévő sorok `type`-ja és `source`-a. A típust a `barcodeType` adja (a JEV
 *    `validateGtin`), a forrás `IMPORT`: a mai sorok a cikkszám-importból jöttek
 *    (a stage-en mind a 763 kód betűre a változat cikkszáma, 2026-10-07).
 *
 * 2. A gyártói cikkszám ma kint lévő kódjai (D1: egy forrás marad). A mai vetítés
 *    a `manufacturerPartNumber`-ből viszi a vonalkódot; ha a forrás a
 *    `ProductBarcode` lesz, ezek a kódok csak akkor maradnak a boltban, ha ide
 *    átkerülnek. A szabály ugyanaz, mint a mai vetítésé (`decideMedusaBarcode`):
 *    érvényes, termék-tartományú EAN-13 vagy UPC-A, nem ismétlődő (a két
 *    írásmódot egynek látva). A kód úgy kerül át, ahogy áll (a 12 jegyű UPC-A 12
 *    jegyen), `source = UNAS`, primary, mert a változatnak nincs sora.
 *
 * AMIT NEM VESZ ÁT (D2): ha a változatnak VAN `ProductBarcode` sora, és a gyártói
 * cikkszám egy MÁSIK érvényes kód, gép nem dönt. A lista a jelentésbe megy, emberi
 * átnézésre (`exchange/seo/pr4-d2-56-elteres-2026-10-07.md`).
 */
export interface BackfillBarcodeRow {
  id: string;
  variantId: string;
  code: string;
  type: ProductBarcodeType | null;
  source: string | null;
}

export interface BackfillVariantRow {
  variantId: string;
  sku: string;
  manufacturerPartNumber: string | null;
  isActive: boolean;
}

export interface BarcodeBackfillPlan {
  typeUpdates: { id: string; type: ProductBarcodeType; setSource: boolean }[];
  newRows: { variantId: string; code: string; type: ProductBarcodeType }[];
  /** D2: két különböző érvényes kód ugyanazon a változaton. */
  conflicts: { variantId: string; sku: string; barcode: string; mpn: string }[];
  skipped: {
    duplicate: number;
    notProductGtin: number;
    codeTaken: number;
    inactive: number;
  };
  typeCounts: Partial<Record<ProductBarcodeType, number>>;
}

export function planBarcodeBackfill(
  barcodes: readonly BackfillBarcodeRow[],
  variants: readonly BackfillVariantRow[],
): BarcodeBackfillPlan {
  const typeCounts: Partial<Record<ProductBarcodeType, number>> = {};
  const typeUpdates: BarcodeBackfillPlan["typeUpdates"] = [];
  for (const row of barcodes) {
    const type = barcodeType(row.code);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (row.type !== type || row.source === null)
      typeUpdates.push({ id: row.id, type, setSource: row.source === null });
  }

  const codesByVariant = new Map<string, string[]>();
  const allCodes = new Set<string>();
  for (const row of barcodes) {
    codesByVariant.set(row.variantId, [
      ...(codesByVariant.get(row.variantId) ?? []),
      row.code,
    ]);
    allCodes.add(row.code);
  }
  // az ismétlődés-számlálás a mai vetítéséhez hasonló: aktív változatok gyártói
  // cikkszáma, a két írásmódot egynek látva
  const mpnCount = new Map<string, number>();
  for (const v of variants)
    if (v.isActive)
      for (const alak of vonalkodAlakjai(v.manufacturerPartNumber))
        mpnCount.set(alak, (mpnCount.get(alak) ?? 0) + 1);

  const newRows: BarcodeBackfillPlan["newRows"] = [];
  const conflicts: BarcodeBackfillPlan["conflicts"] = [];
  const skipped = {
    duplicate: 0,
    notProductGtin: 0,
    codeTaken: 0,
    inactive: 0,
  };
  for (const v of variants) {
    const mpn = v.manufacturerPartNumber?.trim() ?? "";
    if (!/^\d{8,14}$/.test(mpn)) continue;
    const alakok = vonalkodAlakjai(mpn);
    const own = codesByVariant.get(v.variantId) ?? [];
    if (own.some((code) => alakok.includes(code))) continue; // már megvan
    const sameValueCount = Math.max(
      1,
      ...alakok.map((alak) => mpnCount.get(alak) ?? 0),
    );
    const decision = decideMedusaBarcode(mpn, sameValueCount, false);
    // D2 ELŐBB: ha a változatnak már van sora, és a gyártói cikkszám egy MÁSIK
    // érvényes termék-kód, az emberi döntés, akkor is, ha a kód ismétlődik
    if (own.length > 0) {
      if (
        decision.kind === "ean" ||
        decision.kind === "upc" ||
        decision.kind === "skipped"
      )
        conflicts.push({
          variantId: v.variantId,
          sku: v.sku,
          barcode: own[0]!,
          mpn,
        });
      continue;
    }
    if (decision.kind === "skipped") {
      skipped.duplicate += 1;
      continue;
    }
    if (decision.kind !== "ean" && decision.kind !== "upc") {
      skipped.notProductGtin += 1;
      continue;
    }
    if (!v.isActive) {
      skipped.inactive += 1;
      continue;
    }
    if (alakok.some((alak) => allCodes.has(alak))) {
      skipped.codeTaken += 1;
      continue;
    }
    newRows.push({ variantId: v.variantId, code: mpn, type: barcodeType(mpn) });
    for (const alak of alakok) allCodes.add(alak);
  }
  return { typeUpdates, newRows, conflicts, skipped, typeCounts };
}

/** A szárazfutás jelentése: számok, és a D2 lista. */
export function describeBackfillPlan(plan: BarcodeBackfillPlan): string {
  const tipusok = Object.entries(plan.typeCounts)
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");
  return [
    `Meglevo sorok tipusa: ${tipusok}`,
    `Tipus/forras frissitendo: ${plan.typeUpdates.length} sor`,
    `Uj sor a gyartoi cikkszambol (source UNAS): ${plan.newRows.length}`,
    `Kihagyva: ismetlodo ${plan.skipped.duplicate}, nem termek-GTIN ${plan.skipped.notProductGtin}, ` +
      `a kod mar mashol all ${plan.skipped.codeTaken}, inaktiv valtozat ${plan.skipped.inactive}`,
    `D2, emberi atnezesre (ket kulonbozo ervenyes kod, gep nem dont): ${plan.conflicts.length}`,
    ...plan.conflicts.map(
      (c) => `  ${c.sku}: cikkszam-kod ${c.barcode}, gyartoi cikkszam ${c.mpn}`,
    ),
    "",
  ].join("\n");
}
