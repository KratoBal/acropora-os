import {
  compactNumber,
  customerIds,
  looksLikeProforma,
  looksLikeTaxNumber,
  readInvoiceText,
  type InvoiceTextReading,
} from "./invoice-text.js";

/**
 * EGY MÁR TÁROLT DOKUMENTUM ÁLTALÁNOS OLVASÁSA ÚJRA, A MAI SZABÁLYOKKAL
 * (acrobot 26153, FleetCor: öt tárolt PDF az ügyfél-azonosítót kapta
 * számlaszámnak).
 *
 * MIÉRT KÜLÖN ÚT: a begyűjtés újraértékelése (`invoice-collection:reread`) a
 * már tárolt tartalmat DUPLICATE-nek látja, és nem olvassa újra; a tárolt
 * olvasat így a szabály javítása után is a régi marad.
 *
 * CSAK A `textReading` VÁLTOZIK, és csak a megnevezett dokumentumokon. A
 * szállítói illesztő olvasatát (`importResult`) nem bántja: az a dokumentum nem
 * az általános olvasón ment át. A banki hivatkozás és a kártyás fizetés a régi
 * olvasatból megmarad: azokat a begyűjtés a bank adataiból számolta, nem a
 * szövegből.
 *
 * Ha az új olvasás nem talál számot, a régi szám marad, KIVÉVE ha az a
 * szövegben ügyfél-azonosítóként áll, vagy adószám: az soha nem számlaszám.
 * Egy adószám banki hivatkozásnak sem marad meg (acrobot 26158, UNAS).
 *
 * A FAJTA (`kind`) EGY IRÁNYBAN VÁLTOZHAT: számlából díjbekérő, ha a szöveg
 * díjbekérőnek mondja magát (ugyanaz a `looksLikeProforma`, amivel a begyűjtés
 * tárol). Visszafelé soha, és a kézi feltöltésé soha: annak fajtáját ember adta.
 */

export interface StoredTextDocument {
  id: string;
  fileName: string;
  subject: string | null;
  content: Uint8Array;
  textReading: unknown;
  importResult: unknown;
  kind: string | null;
  origin: string;
}

export interface StoredTextSelector {
  ids: readonly string[];
  /** a tárolt (hibás) számlaszám, amire a dokumentumokat keressük */
  number: string | null;
}

export interface StoredTextRereadDeps {
  documents(selector: StoredTextSelector): Promise<StoredTextDocument[]>;
  lines(content: Uint8Array): Promise<string[]>;
  navNumbers(supplierTaxBase: string): Promise<readonly string[]>;
  save(
    id: string,
    reading: InvoiceTextReading,
    kind: string | null,
  ): Promise<void>;
}

type Brief = Pick<
  InvoiceTextReading,
  "invoiceNumber" | "numberFrom" | "supplierTaxNumber"
> & { kind: string | null };

export interface StoredTextRereadRow {
  id: string;
  fileName: string;
  /**
   * Nem írja (és miért): illesztő olvasta, olvashatatlan, vagy egy meglévő
   * számot ÜRESRE írna `--allow-clear` nélkül. `null`: írja, ha változott.
   */
  skipped: "ADAPTER_READ" | "UNREADABLE" | "WOULD_CLEAR" | null;
  before: Brief | null;
  after: Brief | null;
  changed: boolean;
}

const brief = (
  reading: Partial<InvoiceTextReading> | null,
  kind: string | null,
): Brief | null =>
  reading
    ? {
        invoiceNumber: reading.invoiceNumber ?? null,
        numberFrom: reading.numberFrom ?? null,
        supplierTaxNumber: reading.supplierTaxNumber ?? null,
        kind,
      }
    : null;

const taxBase = (tax: string): string =>
  tax.replace(/^HU/, "").replace(/\D/g, "").slice(0, 8);

export async function rereadStoredText(
  deps: StoredTextRereadDeps,
  selector: StoredTextSelector,
  apply: boolean,
  /**
   * Egy meglévő számot üresre írhat-e. Alapból NEM (acrobot 26157): a FleetCor
   * számla-áttekintésének `BANK:HU00008659` olvasata a száraz körben üresre
   * váltott volna. Ott ez helyes (az ügyfél-azonosító nem szám), de egy szám
   * eltűnése nem történhet csendben: a sor `WOULD_CLEAR`, és csak kifejezett
   * engedéllyel íródik.
   */
  allowClear = false,
): Promise<StoredTextRereadRow[]> {
  const rows: StoredTextRereadRow[] = [];
  for (const document of await deps.documents(selector)) {
    const old = (
      document.textReading && typeof document.textReading === "object"
        ? document.textReading
        : null
    ) as Partial<InvoiceTextReading> | null;
    const base = {
      id: document.id,
      fileName: document.fileName,
      before: brief(old, document.kind),
    };
    if (document.importResult !== null) {
      rows.push({
        ...base,
        skipped: "ADAPTER_READ",
        after: null,
        changed: false,
      });
      continue;
    }
    let lines: string[];
    try {
      lines = await deps.lines(document.content);
    } catch {
      rows.push({
        ...base,
        skipped: "UNREADABLE",
        after: null,
        changed: false,
      });
      continue;
    }
    const hints = { fileName: document.fileName, subject: document.subject };
    const supplier = readInvoiceText(lines, hints).supplierTaxNumber;
    const navNumbers = supplier ? await deps.navNumbers(taxBase(supplier)) : [];
    const fresh = readInvoiceText(lines, {
      ...hints,
      navNumbers: () => navNumbers,
    });
    const oldNumber = old?.invoiceNumber ?? null;
    const keepOld =
      fresh.invoiceNumber === null &&
      oldNumber !== null &&
      !looksLikeTaxNumber(oldNumber) &&
      !customerIds(lines).has(compactNumber(oldNumber));
    const next: InvoiceTextReading = {
      ...fresh,
      ...(keepOld
        ? { invoiceNumber: oldNumber, numberFrom: old?.numberFrom ?? null }
        : {}),
      ...(old?.bankReference && !looksLikeTaxNumber(old.bankReference)
        ? { bankReference: old.bankReference }
        : {}),
      ...(old?.cardPayment ? { cardPayment: old.cardPayment } : {}),
    };
    const kind =
      document.kind === "INVOICE" &&
      document.origin !== "UPLOAD" &&
      looksLikeProforma(lines.join("\n"))
        ? "PROFORMA"
        : document.kind;
    const changed =
      JSON.stringify(brief(old, document.kind)) !==
        JSON.stringify(brief(next, kind)) ||
      (old?.bankReference ?? null) !== (next.bankReference ?? null);
    const clears = oldNumber !== null && next.invoiceNumber === null;
    if (clears && !allowClear) {
      rows.push({
        ...base,
        skipped: "WOULD_CLEAR",
        after: brief(next, kind),
        changed,
      });
      continue;
    }
    if (apply && changed) await deps.save(document.id, next, kind);
    rows.push({ ...base, skipped: null, after: brief(next, kind), changed });
  }
  return rows;
}

/** A kimenet: soronként egy dokumentum, régi -> új. */
export function rereadReport(
  rows: readonly StoredTextRereadRow[],
  apply: boolean,
): string {
  const show = (b: Brief | null) =>
    b
      ? `${b.numberFrom ?? "-"}:${b.invoiceNumber ?? "-"} (${b.supplierTaxNumber ?? "-"}) [${b.kind ?? "-"}]`
      : "-";
  const changed = rows.filter((row) => row.changed && !row.skipped).length;
  return [
    `${apply ? "átírva" : "átírná"}: ${changed} / ${rows.length} dokumentum\n`,
    ...rows.map(
      (row) =>
        `  ${row.id}\t${row.fileName}\t${
          row.skipped === "WOULD_CLEAR"
            ? `kihagyva (a számot üresre írná, csak --allow-clear-rel): ${show(row.before)} -> ${show(row.after)}`
            : row.skipped
              ? `kihagyva (${row.skipped})`
              : `${show(row.before)} -> ${show(row.after)}${row.changed ? "" : "  (változatlan)"}`
        }\n`,
    ),
  ].join("");
}
