import { parseBarcode } from "./barcode.util.js";

export type ImportRowOutcome =
  | "CREATED"
  | "ALREADY_PRESENT"
  | "TAKEN_BY_OTHER_VARIANT"
  | "UNKNOWN_SKU"
  | "INVALID_BARCODE"
  | "MALFORMED_ROW"
  | "DUPLICATE_IN_FILE";

export interface ParsedImportRow {
  line: number;
  sku: string;
  code: string;
  isPrimary?: boolean;
  eanCheckDigitValid: boolean | null;
}

export interface RejectedImportRow {
  line: number;
  outcome: Extract<
    ImportRowOutcome,
    "MALFORMED_ROW" | "INVALID_BARCODE" | "DUPLICATE_IN_FILE"
  >;
  reason: string;
  raw: string;
}

export interface ParsedImportFile {
  rows: ParsedImportRow[];
  rejected: RejectedImportRow[];
}

const REQUIRED_HEADER = ["sku", "barcode"];

/**
 * Parses the barcode import file.
 *
 * The format is a deliberate contract with whoever produces the list, not a
 * guess: a header row naming the columns, then `sku,barcode` and optionally
 * `isPrimary`. The header is required so that a shifted column order fails
 * loudly instead of importing barcodes as SKUs.
 *
 * A bad row never aborts the file. This import runs once, against production,
 * with someone watching - "row 412 is malformed, the other 790 went in" is
 * useful, and "nothing happened because row 412 is malformed" is not.
 */
export function parseImportFile(content: string): ParsedImportFile {
  const lines = content.split(/\r?\n/);
  const rows: ParsedImportRow[] = [];
  const rejected: RejectedImportRow[] = [];
  const seen = new Map<string, number>();

  let headerIndex = -1;
  let columns: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    columns = splitRow(line).map((cell) => cell.toLowerCase());
    headerIndex = index;
    break;
  }

  if (headerIndex === -1)
    throw new Error("A fájl üres, nincs benne fejléc sem.");
  for (const required of REQUIRED_HEADER)
    if (!columns.includes(required))
      throw new Error(
        `Hiányzó oszlop a fejlécben: "${required}". Várt fejléc: sku,barcode[,isPrimary]`,
      );

  const skuAt = columns.indexOf("sku");
  const codeAt = columns.indexOf("barcode");
  const primaryAt = columns.indexOf("isprimary");

  for (const [index, line] of lines.entries()) {
    if (index <= headerIndex || !line.trim()) continue;
    const cells = splitRow(line);
    const number = index + 1;

    const sku = cells[skuAt]?.trim();
    const rawCode = cells[codeAt];
    if (!sku || rawCode === undefined) {
      rejected.push({
        line: number,
        outcome: "MALFORMED_ROW",
        reason: "Hiányzó cikkszám vagy vonalkód oszlop.",
        raw: line,
      });
      continue;
    }

    const parsed = parseBarcode(rawCode);
    if (!parsed.valid) {
      rejected.push({
        line: number,
        outcome: "INVALID_BARCODE",
        reason: parsed.reason,
        raw: line,
      });
      continue;
    }

    const earlier = seen.get(parsed.code);
    if (earlier !== undefined) {
      rejected.push({
        line: number,
        outcome: "DUPLICATE_IN_FILE",
        reason: `Ez a vonalkód már szerepel a fájl ${earlier}. sorában.`,
        raw: line,
      });
      continue;
    }
    seen.set(parsed.code, number);

    rows.push({
      line: number,
      sku,
      code: parsed.code,
      ...(primaryAt === -1
        ? {}
        : { isPrimary: parseBoolean(cells[primaryAt]) }),
      eanCheckDigitValid: parsed.eanCheckDigitValid,
    });
  }

  return { rows, rejected };
}

function splitRow(line: string): string[] {
  return line.split(",").map((cell) =>
    cell
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim(),
  );
}

function parseBoolean(value: string | undefined): boolean | undefined {
  const normalised = value?.trim().toLowerCase();
  if (!normalised) return undefined;
  if (["1", "true", "igen", "yes", "y"].includes(normalised)) return true;
  if (["0", "false", "nem", "no", "n"].includes(normalised)) return false;
  return undefined;
}

export function summarise(
  outcomes: readonly ImportRowOutcome[],
): Record<ImportRowOutcome, number> {
  const empty: Record<ImportRowOutcome, number> = {
    CREATED: 0,
    ALREADY_PRESENT: 0,
    TAKEN_BY_OTHER_VARIANT: 0,
    UNKNOWN_SKU: 0,
    INVALID_BARCODE: 0,
    MALFORMED_ROW: 0,
    DUPLICATE_IN_FILE: 0,
  };
  for (const outcome of outcomes) empty[outcome] += 1;
  return empty;
}
