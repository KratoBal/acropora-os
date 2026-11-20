import {
  incomingPdfIds,
  type IncomingPdfRow,
  type IncomingPdfSources,
} from "./incoming-pdf-state.js";
import {
  supplierAccountCandidates,
  supplierAccountVerdict,
  type SupplierAccountCandidate,
  type SupplierAccountVerdict,
} from "./supplier-bank-account-text.js";

/**
 * A SZÁLLÍTÓI BANKSZÁMLASZÁM KINYERÉSE A TÁROLT PDF-EKBŐL, SZÁRAZ MÉRÉS (acrobot 58433): a Lejáró számlák számlaszám nélküli soraira megméri, a begyűjtött PDF
 * szövegéből mennyi számlaszám olvasható ki, és milyen alakban. SEMMIT NEM ÍR. A kimenet CSAK darabszám, a számlaszám VÉGE (négy jegy), a találat típusa és a címke:
 * a teljes számlaszám nem hagyja el a folyamatot. A szabályokat és a miértet a `supplier-bank-account-text.ts` mondja.
 *
 * A függőségek kívülről jönnek (az adatbázis, a PDF-olvasó, a saját számlaszámaink), így a mérés tesztelhető, és a parancs (`...extract.cli.ts`) csak bekötés.
 */
export interface ExtractTarget {
  readonly id: string;
  readonly supplierName: string;
  readonly documentNumber: string;
  /** a begyűjtött PDF-ek azonosítói (a Lejáró számlák PDF-jelzésének kulcsa szerint) */
  readonly pdfIds: readonly string[];
}

export interface ExtractDeps {
  targets(): Promise<readonly ExtractTarget[]>;
  /** a PDF bájtjai; `null`: nincs ilyen dokumentum */
  content(id: string): Promise<Uint8Array | null>;
  /** a `pdfTextLines`; hibánál dob */
  lines(content: Uint8Array): Promise<string[]>;
  /** a saját bankszámláink (számjegyek) */
  ownAccounts(): Promise<readonly string[]>;
}

/** Egy PDF olvasata: milyen állapotban volt, és mit adott. */
export type PdfOutcome =
  | { readonly state: "UNREADABLE" }
  | { readonly state: "NO_TEXT" }
  | {
      readonly state: "TEXT";
      readonly candidates: readonly SupplierAccountCandidate[];
    };

export interface ExtractRow {
  readonly id: string;
  readonly supplierName: string;
  readonly documentNumber: string;
  readonly pdfCount: number;
  readonly unreadable: number;
  readonly noText: number;
  readonly verdict: SupplierAccountVerdict;
  /** az egy számlaszám esetén: a vége, a fajtája és a címkéje; a teljes szám NEM */
  readonly tail: string | null;
  readonly kind: SupplierAccountCandidate["kind"] | null;
  readonly label: SupplierAccountCandidate["label"] | null;
}

export interface ExtractReport {
  readonly targets: number;
  readonly withPdf: number;
  readonly one: number;
  readonly several: number;
  readonly none: number;
  readonly unreadable: number;
  readonly noText: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byLabel: Readonly<Record<string, number>>;
  readonly rows: readonly ExtractRow[];
}

const last4 = (account: string) => account.slice(-4);

export async function readPdfOutcome(
  deps: Pick<ExtractDeps, "content" | "lines">,
  id: string,
  own: readonly string[],
): Promise<PdfOutcome> {
  const content = await deps.content(id);
  if (!content) return { state: "UNREADABLE" };
  let lines: string[];
  try {
    lines = await deps.lines(content);
  } catch {
    return { state: "UNREADABLE" };
  }
  // az oldalvég-jelen kívül nincs szöveg: beszkennelt (képes) PDF, ezt másik út olvassa
  if (lines.every((line) => line.startsWith("=== oldal") || !line.trim()))
    return { state: "NO_TEXT" };
  return { state: "TEXT", candidates: supplierAccountCandidates(lines, own) };
}

export async function extractSupplierAccounts(
  deps: ExtractDeps,
): Promise<ExtractReport> {
  const [targets, own] = await Promise.all([
    deps.targets(),
    deps.ownAccounts(),
  ]);
  const rows: ExtractRow[] = [];
  for (const target of targets) {
    const outcomes: PdfOutcome[] = [];
    for (const id of target.pdfIds)
      outcomes.push(await readPdfOutcome(deps, id, own));
    // egy számla több PDF-je együtt számít: ha két különböző számlaszámot adnak, „több jelölt”
    const candidates = outcomes.flatMap((outcome) =>
      outcome.state === "TEXT" ? outcome.candidates : [],
    );
    const verdict = supplierAccountVerdict(candidates);
    const chosen =
      verdict.state === "ONE"
        ? candidates.find((c) => c.account === verdict.account)!
        : null;
    rows.push({
      id: target.id,
      supplierName: target.supplierName,
      documentNumber: target.documentNumber,
      pdfCount: target.pdfIds.length,
      unreadable: outcomes.filter((o) => o.state === "UNREADABLE").length,
      noText: outcomes.filter((o) => o.state === "NO_TEXT").length,
      verdict,
      tail: chosen ? last4(chosen.account) : null,
      kind: chosen?.kind ?? null,
      // több PDF ugyanazt a számot adhatja: a legerősebb címke számít
      label: chosen
        ? candidates.some(
            (c) => c.account === chosen.account && c.label === "BANK",
          )
          ? "BANK"
          : "GENERIC"
        : null,
    });
  }
  const count = (state: SupplierAccountVerdict["state"]) =>
    rows.filter((row) => row.verdict.state === state).length;
  const tally = (pick: (row: ExtractRow) => string | null) => {
    const out: Record<string, number> = {};
    for (const row of rows) {
      const key = row.verdict.state === "ONE" ? pick(row) : null;
      if (key) out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };
  return {
    targets: rows.length,
    withPdf: rows.filter((row) => row.pdfCount > 0).length,
    one: count("ONE"),
    several: count("SEVERAL"),
    none: count("NONE"),
    unreadable: rows.reduce((sum, row) => sum + row.unreadable, 0),
    noText: rows.reduce((sum, row) => sum + row.noText, 0),
    byKind: tally((row) => row.kind),
    byLabel: tally((row) => row.label),
    rows,
  };
}

/** A riport szövege: a számlaszámból csak a vége, a számla száma és a szállító neve szerepel. */
export function formatExtractReport(report: ExtractReport): string {
  const out: string[] = [
    "SZÁLLÍTÓI BANKSZÁMLASZÁM A TÁROLT PDF-BŐL (szárazon, semmi nem íródott)",
    `célsor: ${report.targets}, ebből begyűjtött PDF-fel: ${report.withPdf}`,
    `egy számlaszám (kitölthető): ${report.one}; több különböző (nincs adat, N jelölt): ${report.several}; nincs: ${report.none}`,
    `nem olvasható PDF: ${report.unreadable}; szöveg nélküli (beszkennelt) PDF: ${report.noText}`,
    `a kitölthetők fajtája: ${JSON.stringify(report.byKind)}; címkéje: ${JSON.stringify(report.byLabel)}`,
    "",
  ];
  for (const row of report.rows) {
    const verdict =
      row.verdict.state === "ONE"
        ? `EGY ...${row.tail} ${row.kind} ${row.label}`
        : row.verdict.state === "SEVERAL"
          ? `TÖBB (${row.verdict.count} jelölt)`
          : "NINCS";
    out.push(
      `${row.supplierName} | ${row.documentNumber} | pdf=${row.pdfCount} nemolvashato=${row.unreadable} szovegnelkuli=${row.noText} | ${verdict}`,
    );
  }
  return `${out.join("\n")}\n`;
}

/**
 * AZ OLVASANDÓ PDF-EK EGY SORHOZ: az EGY PDF-szabály (`incomingPdfIds`), a feed saját dokumentuma nélkül, ha az NEM PDF (`hasPdf` hamis). A feed `sourceDocumentId`-ja akkor is egy dokumentumra mutat,
 * ha a feed `pdf` mezője nem valódi PDF volt: az olvasása mindig hibára futna, és az élő mérésben (2026-11-20, 63 célsor) minden sorhoz EGY „nem olvasható PDF”-et adott, tehát a
 * riport „nem olvasható: 63” száma zaj volt, nem hiba. A kézzel csatolt és a begyűjtött PDF-ek változatlanul benne vannak.
 */
export function pdfIdsToRead(
  row: IncomingPdfRow,
  sources: IncomingPdfSources,
): string[] {
  return incomingPdfIds(row, sources).filter(
    (id) => id !== row.sourceDocumentId || row.hasPdf === true,
  );
}
