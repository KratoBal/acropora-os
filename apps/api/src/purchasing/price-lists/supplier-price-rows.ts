import { Prisma } from "@acropora/database";
import type { SupplierPriceRow } from "@acropora/types";

/**
 * A BESZERZÉSI ÁR FORINTBAN ÉS A HASZON (task beszallitoi-arlistak-4; az 1.
 * szelet tervének 2. pontja és barracuda elfogadási feltétele: a `vatRate`
 * SZÁZALÉK, 27, nem 0,27; a haszon a nettó eladási árból számol).
 *
 *   beszerzés HUF  = egységár × az MNB árfolyam (HUF egy devizaegységre)
 *   haszon HUF     = nettó eladási ár − beszerzés HUF
 *   haszon %       = haszon HUF / nettó eladási ár × 100
 *
 * A nettó eladási ár forrása a `loadVariantListPrices` (a törzsadat gazdája dönt
 * a tükör és a saját ár között, a nettót a változat áfakulcsa adja:
 * bruttó / (1 + vatRate / 100)). Ide a kész nettó érkezik, vagy `null`.
 *
 * Kimaradó adat sosem nulla: árfolyam nélkül nincs forintár és haszon, eladási ár
 * nélkül nincs haszon. A szállítási, vám- és egyéb költség NINCS benne.
 */

export interface PriceRowSource {
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  listedName: string | null;
  unitPrice: string;
  currency: string;
  listRetailPrice: string | null;
  listDate: Date;
  matchStatus: "AUTO" | "APPROVED";
  matchMethod: "EAN" | "SUPPLIER_CODE" | "NAME";
}

export interface FxQuote {
  /** HUF egy devizaegységre, szövegként. */
  rate: string;
  /** Az MNB jegyzésének napja (ÉÉÉÉ-HH-NN). */
  quotedDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const money = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

export function computeSupplierPriceRows(input: {
  rows: readonly PriceRowSource[];
  /** A mai nettó eladási ár forintban, vagy `null`. */
  sellingNet: Prisma.Decimal | null;
  fx: ReadonlyMap<string, FxQuote | null>;
  now: Date;
}): SupplierPriceRow[] {
  const rows = input.rows.map(
    (row): SupplierPriceRow & { sortKey: Prisma.Decimal | null } => {
      const quote =
        row.currency === "HUF"
          ? { rate: "1", quotedDate: null }
          : (input.fx.get(row.currency) ?? null);
      const unitPrice = new Prisma.Decimal(row.unitPrice);
      const purchase = quote
        ? unitPrice.times(new Prisma.Decimal(quote.rate))
        : null;
      const profit =
        purchase && input.sellingNet ? input.sellingNet.minus(purchase) : null;
      const percent =
        profit && input.sellingNet && input.sellingNet.greaterThan(0)
          ? profit.dividedBy(input.sellingNet).times(100)
          : null;
      return {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        supplierSku: row.supplierSku,
        listedName: row.listedName,
        unitPrice: row.unitPrice,
        currency: row.currency,
        listRetailPrice: row.listRetailPrice,
        listDate: row.listDate.toISOString().slice(0, 10),
        listAgeDays: Math.max(
          0,
          Math.floor((input.now.getTime() - row.listDate.getTime()) / DAY_MS),
        ),
        matchStatus: row.matchStatus,
        matchMethod: row.matchMethod,
        fxRate: quote ? quote.rate : null,
        fxDate: quote?.quotedDate ?? null,
        purchaseHuf: purchase ? money(purchase) : null,
        profitHuf: profit ? money(profit) : null,
        profitPercent: percent ? money(percent) : null,
        sortKey: purchase,
      };
    },
  );
  // a legolcsóbb beszerzés elöl, az árfolyam nélküli sor a végén
  rows.sort((a, b) => {
    if (a.sortKey && b.sortKey) {
      const diff = a.sortKey.comparedTo(b.sortKey);
      if (diff !== 0) return diff;
    } else if (a.sortKey || b.sortKey) {
      return a.sortKey ? -1 : 1;
    }
    return a.supplierName.localeCompare(b.supplierName, "hu");
  });
  return rows.map(({ sortKey: _sortKey, ...row }) => row);
}
