import { isOwnInvoiceText, type InvoiceTextReading } from "./invoice-text.js";

/**
 * A RÉGEN TÁROLT SAJÁT KIMENŐ SZÁMLÁK KIVEZETÉSE A JELÖLTEK KÖZÜL (acrobot
 * 26161-26163).
 *
 * A #1315 óta a begyűjtés a saját kimenő számlánkat nem tárolja (OWN_INVOICE).
 * A korábban tárolt sorok viszont jelöltek maradtak, és a banki ág a saját
 * adószámunkat adta nekik számnak: élesen kb. 151 E-ACRW-*.pdf, és öt
 * szeptemberi NAV-utalás közleménye pontosan „23916229-2-42”. Az 1. szabály
 * így az első ilyen terheléshez mind a 151-et párosíthatta.
 *
 * A JELÖLÉS `reviewState = "OWN_INVOICE"`: a Hiányzó számlák jelöltjei csak a
 * `reviewState: null` sorok, tehát a dokumentum azonnal kiesik. Nem töröl, a
 * sémát nem változtatja, és visszafordítható (`--undo`).
 *
 * UGYANAZ A PRÓBA, AMIT A GYŰJTŐ FUTTAT (`isOwnInvoiceText`): a szövegben a
 * saját bankszámlánk áll. Nem a fájlnévre szűr. És ugyanott NEM futtatja,
 * ahol a gyűjtő sem: a szállítói illesztő olvasta és a NAV-számmal olvasott
 * dokumentumon (az a szállító NAV-ban ismert számlája, nem a miénk).
 *
 * Amire kézi párosítás mutat, azt nem jelöli: kiírja, és ember dönt róla.
 */
export const OWN_INVOICE_REVIEW_STATE = "OWN_INVOICE";

export interface MarkCandidate {
  id: string;
  fileName: string;
  content: Uint8Array;
  textReading: unknown;
  importResult: unknown;
}

export interface OwnInvoiceMarkDeps {
  /** A tárolt begyűjtött dokumentumok, amik ma jelöltek (`reviewState` NULL). */
  candidates(): Promise<MarkCandidate[]>;
  lines(content: Uint8Array): Promise<string[]>;
  ownAccounts(): Promise<readonly string[]>;
  /** A kézi párosítások dokumentum-azonosítói. */
  manuallyPaired(): Promise<ReadonlySet<string>>;
  mark(ids: readonly string[]): Promise<number>;
}

export type MarkSkip = "ADAPTER_READ" | "NAV_NUMBER" | "UNREADABLE";

export interface OwnInvoiceMarkReport {
  checked: number;
  /** a próba szerint saját kimenő számla, és jelölhető */
  own: { id: string; fileName: string }[];
  /** saját kimenő számla, de kézi párosítás mutat rá: NEM jelöli */
  paired: { id: string; fileName: string }[];
  skipped: Record<MarkSkip, number>;
  marked: number;
}

export async function markOwnInvoices(
  deps: OwnInvoiceMarkDeps,
  apply: boolean,
): Promise<OwnInvoiceMarkReport> {
  const [documents, accounts, paired] = await Promise.all([
    deps.candidates(),
    deps.ownAccounts(),
    deps.manuallyPaired(),
  ]);
  const report: OwnInvoiceMarkReport = {
    checked: documents.length,
    own: [],
    paired: [],
    skipped: { ADAPTER_READ: 0, NAV_NUMBER: 0, UNREADABLE: 0 },
    marked: 0,
  };
  for (const document of documents) {
    if (document.importResult !== null) {
      report.skipped.ADAPTER_READ++;
      continue;
    }
    const reading = document.textReading as Partial<InvoiceTextReading> | null;
    if (reading?.numberFrom === "NAV") {
      report.skipped.NAV_NUMBER++;
      continue;
    }
    let lines: string[];
    try {
      lines = await deps.lines(document.content);
    } catch {
      report.skipped.UNREADABLE++;
      continue;
    }
    if (!isOwnInvoiceText(lines.join("\n"), accounts)) continue;
    const row = { id: document.id, fileName: document.fileName };
    (paired.has(document.id) ? report.paired : report.own).push(row);
  }
  if (apply && report.own.length > 0)
    report.marked = await deps.mark(report.own.map((row) => row.id));
  return report;
}

export function markReport(
  report: OwnInvoiceMarkReport,
  apply: boolean,
): string {
  const line = (row: { id: string; fileName: string }) =>
    `  ${row.id}\t${row.fileName}\n`;
  return [
    `ellenőrizve: ${report.checked} tárolt begyűjtött dokumentum ` +
      `(kihagyva: illesztő olvasta ${report.skipped.ADAPTER_READ}, ` +
      `NAV-számmal olvasott ${report.skipped.NAV_NUMBER}, ` +
      `olvashatatlan ${report.skipped.UNREADABLE})\n`,
    `saját kimenő számla: ${report.own.length}, ${
      apply ? `megjelölve: ${report.marked}` : "a száraz kör nem ír"
    }\n`,
    ...report.own.map(line),
    `kézi párosítás mutat rá, NEM jelöli: ${report.paired.length}\n`,
    ...report.paired.map(line),
  ].join("");
}
