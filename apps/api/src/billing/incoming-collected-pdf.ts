import { hungarianTaxBase } from "../purchasing/nav-incoming-invoices/nav-incoming-invoice.types.js";

/**
 * A BEJÖVŐ SZÁMLA PDF-JE A BEGYŰJTÉSBŐL, HA A FEED NEM HOZOTT (Balázs, OTP
 * szál, 2026-10-04 08:10 UTC: a KS26/11679 „nincs PDF”-et mutatott, holott a
 * levélből már be volt gyűjtve).
 *
 * Élesen mérve (acrobot, 2026-10-04): 85 bejövő számlából 5-nél küldött PDF-et a
 * Számlázz.hu; a maradék 80-ból 79-hez áll begyűjtött dokumentum, amelynek az
 * olvasott számlaszáma a számla száma.
 *
 * A PÁROSÍTÁS KÉT KULCSON ÁLL, nem egyen: a számlaszám ÉS a szállító adószám-
 * törzse (8 jegy). Két szállító számlaszáma egyezhet (mindkettő a saját
 * sorozatát számozza), tehát a szám egyedül egy MÁSIK cég számláját adhatná
 * ki. Adószám nélküli oldalon nincs párosítás.
 *
 * A FEED PDF-JE ELSŐBBSÉGET KAP: ez csak akkor dönt, ha a feed nem hozott.
 * Csak olvas: a sorokat és a dokumentumokat nem írja.
 */

/** Egy begyűjtött dokumentum, amennyi a párosításhoz kell (a tartalma nélkül). */
export interface CollectedDocument {
  id: string;
  fileName: string;
  createdAt: Date;
  /** Az általános olvasó eredménye (`InvoiceTextReading`). */
  textReading: unknown;
  /** Egy szállítói illesztő teljes olvasata (`SupplierInvoiceImportResult`). */
  importResult: unknown;
  /**
   * A beszerzési számla, amihez kézzel csatolták (5ec62e35). Ugyanarra a
   * kulcsra ez áll elöl: a közvetlen kapcsolat nyer a szám szerinti előtt.
   */
  purchaseInvoiceId?: string | null;
}

/** A számla, amihez a PDF-et keressük. */
export interface BillForPdf {
  documentNumber: string;
  supplierTaxNumber: string | null;
  /** A feed saját dokumentuma: azt nem adjuk ki begyűjtöttként. */
  sourceDocumentId: string | null;
}

/** A számlaszám összevetési alakja: szóköz nélkül, nagybetűvel. */
function numberKey(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}

export function invoiceKey(
  number: string | null | undefined,
  taxNumber: string | null | undefined,
): string | null {
  if (!number) return null;
  const n = numberKey(number);
  const base = hungarianTaxBase(taxNumber);
  return n && base ? `${n}|${base}` : null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * A dokumentum kulcsai: a szövegolvasó és a szállítói illesztő is mondhat
 * számlaszámot és adószámot (az illesztő a közösségi alakot, `HU12805637`).
 */
function documentKeys(doc: CollectedDocument): string[] {
  const reading = record(doc.textReading);
  const imported = record(doc.importResult);
  const supplier = record(imported?.supplier);
  const keys = [
    invoiceKey(text(reading?.invoiceNumber), text(reading?.supplierTaxNumber)),
    invoiceKey(text(imported?.invoiceNumber), text(supplier?.vatId)),
  ];
  return [...new Set(keys.filter((key): key is string => key !== null))];
}

/** PDF-nek látszik-e a fájl neve (a tartalmat a letöltés ellenőrzi). */
export function isPdfFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

/**
 * Kulcs -> a dokumentumok azonosítói, a legrégebben gyűjtött elöl. Egyszer
 * épül a listához, így a 85 sor nem 85 lekérdezés.
 */
export function collectedPdfIndex(
  docs: readonly CollectedDocument[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const ordered = [...docs]
    .filter((doc) => isPdfFileName(doc.fileName))
    .sort(
      (a, b) =>
        Number(Boolean(b.purchaseInvoiceId)) -
          Number(Boolean(a.purchaseInvoiceId)) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  for (const doc of ordered)
    for (const key of documentKeys(doc)) {
      const ids = index.get(key) ?? [];
      ids.push(doc.id);
      index.set(key, ids);
    }
  return index;
}

/**
 * A számla begyűjtött PDF-jei, párosítási sorrendben (a feed saját
 * dokumentuma nélkül). Üres: nincs ilyen, vagy a számlának nincs magyar
 * adószáma.
 */
export function collectedPdfIds(
  bill: BillForPdf,
  index: ReadonlyMap<string, readonly string[]>,
): string[] {
  const key = invoiceKey(bill.documentNumber, bill.supplierTaxNumber);
  if (!key) return [];
  return (index.get(key) ?? []).filter((id) => id !== bill.sourceDocumentId);
}

/** Amennyi adatbázis a betöltéshez kell (a tesztek ezt cserélik). */
export interface CollectedPdfSource {
  incomingSupplierDocument: {
    findMany(args: {
      where: { fileName: { endsWith: string; mode: "insensitive" } };
      select: {
        id: true;
        fileName: true;
        createdAt: true;
        textReading: true;
        importResult: true;
        purchaseInvoiceId: true;
      };
    }): Promise<CollectedDocument[]>;
  };
}

/**
 * A begyűjtött PDF-ek indexe az adatbázisból, a tartalmuk nélkül: csak a
 * kulcsok (számlaszám, adószám) kellenek. A bejövő számlák listája és a
 * beszerzési számlák `hasPdf` mezője ugyanezt olvassa.
 */
export async function loadCollectedPdfIndex(
  database: CollectedPdfSource,
): Promise<Map<string, string[]>> {
  return collectedPdfIndex(
    await database.incomingSupplierDocument.findMany({
      where: { fileName: { endsWith: ".pdf", mode: "insensitive" } },
      select: {
        id: true,
        fileName: true,
        createdAt: true,
        textReading: true,
        importResult: true,
        purchaseInvoiceId: true,
      },
    }),
  );
}
