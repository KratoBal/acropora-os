import { Prisma } from "@acropora/database";
import type { PosInternalUseSummaryResponse } from "@acropora/types";

import { budapestDay } from "./pos-payment-summary.js";

/** One internal-use record with its lines, as far as the summary reads it. */
export interface PosInternalUseSummaryRow {
  id: string;
  number: string;
  note: string;
  performedByName: string | null;
  occurredAt: Date;
  totalCost: Prisma.Decimal | null;
  lines: {
    sku: string;
    productName: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitCost: Prisma.Decimal | null;
  }[];
}

/**
 * THE INTERNAL-USE SUMMARY OF A PERIOD (card ada14a7c): the records of the Budapest days `from`..`to`, their purchase value,
 * and the lines without a purchase price listed apart, so it shows what needs a price. Pure: the repository reads a padded
 * range, the day boundaries are decided HERE in Budapest time (as `summarizePosPayments` does).
 *
 * THE KNOWN VALUE IS NOT THE TOTAL WHEN A LINE HAS NO PRICE: `knownCost` sums only the priced lines, and `unpricedLineCount`
 * says how many are missing. A zero for an unknown price would show a falsely small value (the record's own rule).
 */
export function summarizeInternalUses(
  from: string,
  to: string,
  rows: readonly PosInternalUseSummaryRow[],
): PosInternalUseSummaryResponse {
  const inRange = rows
    .filter((row) => {
      const day = budapestDay(row.occurredAt);
      return day >= from && day <= to;
    })
    .sort(
      (a, b) =>
        b.occurredAt.getTime() - a.occurredAt.getTime() ||
        b.id.localeCompare(a.id),
    );
  let knownCost = new Prisma.Decimal(0);
  let lineCount = 0;
  const unpricedLines: PosInternalUseSummaryResponse["unpricedLines"] = [];
  const records: PosInternalUseSummaryResponse["records"] = inRange.map(
    (row) => {
      let unpriced = 0;
      for (const line of row.lines) {
        lineCount += 1;
        if (line.unitCost === null) {
          unpriced += 1;
          unpricedLines.push({
            internalUseId: row.id,
            number: row.number,
            occurredAt: row.occurredAt.toISOString(),
            sku: line.sku,
            productName: line.productName,
            quantity: line.quantity.toString(),
            unit: line.unit,
          });
        } else {
          knownCost = knownCost.plus(line.unitCost.times(line.quantity));
        }
      }
      return {
        id: row.id,
        number: row.number,
        note: row.note,
        performedByName: row.performedByName,
        occurredAt: row.occurredAt.toISOString(),
        totalCost: row.totalCost === null ? null : row.totalCost.toFixed(2),
        lineCount: row.lines.length,
        unpricedLineCount: unpriced,
      };
    },
  );
  return {
    from,
    to,
    recordCount: records.length,
    lineCount,
    knownCost: knownCost.toFixed(2),
    unpricedLineCount: unpricedLines.length,
    records,
    unpricedLines,
  };
}
