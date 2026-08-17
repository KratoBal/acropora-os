import { parseBarcode } from "./barcode.util.js";

export type ImportRowOutcome =
  | "CREATED"
  | "ALREADY_PRESENT"
  | "TAKEN_BY_OTHER_VARIANT"
  | "UNKNOWN_KEY"
  | "AMBIGUOUS_VARIANT"
  | "INVALID_BARCODE"
  | "INVALID_EAN_CHECK_DIGIT"
  | "MALFORMED_ROW"
  | "DUPLICATE_IN_FILE";

/** Which column identified the product in this file. */
export type ImportKeyKind = "unasId" | "sku";

export interface ParsedImportRow {
  line: number;
  key: string;
  code: string;
  isPrimary?: boolean;
}

export interface RejectedImportRow {
  line: number;
  outcome: Extract<
    ImportRowOutcome,
    | "MALFORMED_ROW"
    | "INVALID_BARCODE"
    | "INVALID_EAN_CHECK_DIGIT"
    | "DUPLICATE_IN_FILE"
  >;
  reason: string;
  raw: string;
}

export interface ParsedImportFile {
  keyKind: ImportKeyKind;
  rows: ParsedImportRow[];
  rejected: RejectedImportRow[];
}

/**
 * Parses the barcode import file.
 *
 * The format is a deliberate contract with whoever produces the list, not a
 * guess: a header row naming the columns, then the product key and `barcode`,
 * optionally `isPrimary`. The header is required so that a shifted column
 * order fails loudly instead of importing barcodes as SKUs.
 *
 * The product is identified by **either** `unas_id` or `sku`, never both. The
 * list is prepared from the UNAS side, where only UNAS ids exist - `variantId`
 * is an Acropora-internal identifier nobody outside can know - so `unas_id` is
 * the expected column. `sku` stays supported for a hand-written file.
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
  if (!columns.includes("barcode"))
    throw new Error(
      'Hiányzó oszlop a fejlécben: "barcode". Várt fejléc: unas_id,barcode[,isPrimary]',
    );

  const hasUnasId = columns.includes("unas_id");
  const hasSku = columns.includes("sku");
  if (hasUnasId && hasSku)
    throw new Error(
      'A fejléc "unas_id" és "sku" oszlopot is tartalmaz. Pontosan az egyik azonosítót add meg, hogy egyértelmű legyen, melyik szerint keresünk.',
    );
  if (!hasUnasId && !hasSku)
    throw new Error(
      'Hiányzó azonosító oszlop: "unas_id" vagy "sku" kell a fejlécbe.',
    );

  const keyKind: ImportKeyKind = hasUnasId ? "unasId" : "sku";
  const keyAt = columns.indexOf(hasUnasId ? "unas_id" : "sku");
  const codeAt = columns.indexOf("barcode");
  const primaryAt = columns.indexOf("isprimary");

  for (const [index, line] of lines.entries()) {
    if (index <= headerIndex || !line.trim()) continue;
    const cells = splitRow(line);
    const number = index + 1;

    const key = cells[keyAt]?.trim();
    const rawCode = cells[codeAt];
    if (!key || rawCode === undefined) {
      rejected.push({
        line: number,
        outcome: "MALFORMED_ROW",
        reason: "Hiányzó azonosító vagy vonalkód oszlop.",
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

    // A code that claims to be an EAN/UPC but fails its own check digit is
    // refused outright. Seven such codes are already known in the catalogue,
    // invented by hand rather than read off a product. A code that is not
    // EAN-shaped at all yields `null` here and passes, so internal numbering
    // is unaffected.
    if (parsed.eanCheckDigitValid === false) {
      rejected.push({
        line: number,
        outcome: "INVALID_EAN_CHECK_DIGIT",
        reason: `A(z) ${parsed.code} EAN/UPC alakú, de az ellenőrző számjegye hibás.`,
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
      key,
      code: parsed.code,
      ...(primaryAt === -1
        ? {}
        : { isPrimary: parseBoolean(cells[primaryAt]) }),
    });
  }

  return { keyKind, rows, rejected };
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
    UNKNOWN_KEY: 0,
    AMBIGUOUS_VARIANT: 0,
    INVALID_BARCODE: 0,
    INVALID_EAN_CHECK_DIGIT: 0,
    MALFORMED_ROW: 0,
    DUPLICATE_IN_FILE: 0,
  };
  for (const outcome of outcomes) empty[outcome] += 1;
  return empty;
}
