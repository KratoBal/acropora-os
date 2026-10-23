import { compareDecimal } from "./decimal-text.js";
import type {
  ParsedPriceEntry,
  ParsedPriceList,
  PriceListFormat,
  RejectReason,
} from "./price-list.types.js";

/**
 * What every parser does with a row once it has read it: keep the first row of
 * a code. A later row of the same code with the same price is a harmless
 * repeat (counted); with a different price it is a CONFLICT and is rejected,
 * not merged, because two prices for one code is a fact for a person to look
 * at, and the table's `(listId, supplierSku)` key allows only one.
 */
export class EntryCollector {
  private readonly entries: ParsedPriceEntry[] = [];
  private readonly rejected: ParsedPriceList["rejected"] = [];
  private readonly firstPrice = new Map<string, string>();
  private skipped = 0;
  private repeated = 0;

  skip(): void {
    this.skipped += 1;
  }

  reject(rowNumber: number, reason: RejectReason): void {
    this.rejected.push({ rowNumber, reason });
  }

  add(entry: ParsedPriceEntry): void {
    const earlier = this.firstPrice.get(entry.supplierSku);
    if (earlier !== undefined) {
      if (compareDecimal(earlier, entry.unitPrice) === 0) this.repeated += 1;
      else this.reject(entry.rowNumber, "CONFLICTING_DUPLICATE");
      return;
    }
    this.firstPrice.set(entry.supplierSku, entry.unitPrice);
    this.entries.push(entry);
  }

  result(format: PriceListFormat): ParsedPriceList {
    return {
      format,
      entries: this.entries,
      rejected: this.rejected,
      skippedRows: this.skipped,
      duplicateRows: this.repeated,
    };
  }
}

/** The text of a cell, or "" when the record is shorter than the header (Coralsands has 5-cell rows). */
export function cell(record: readonly string[], index: number): string {
  return (record[index] ?? "").trim();
}

export function isBlankRecord(record: readonly string[]): boolean {
  return record.every((value) => value.trim() === "");
}

/** The index of the first header cell that equals one of `names` (case-insensitive), or -1. */
export function columnIndex(
  header: readonly string[],
  names: readonly string[],
): number {
  const wanted = names.map((name) => name.toLowerCase());
  return header.findIndex((value) => wanted.includes(value.trim().toLowerCase()));
}
