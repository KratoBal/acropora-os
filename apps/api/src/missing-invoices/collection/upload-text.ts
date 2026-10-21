import {
  bankReference,
  readInvoiceText,
  withBankReference,
  withKnownNumber,
  withLabelledTotal,
  type InvoiceTextReading,
  type KnownInvoiceNumber,
} from "./invoice-text.js";

/**
 * EGY KÉZI FELTÖLTÉS ÁLTALÁNOS OLVASÁSA (a szállítói minta nem ismerte fel).
 *
 * Egy helyen, mert két út hívja: a feltöltés maga (`MissingInvoicesService.upload`)
 * és a tárolt feltöltések újraolvasása (`stored-text-reread`, acrobot 34581: a
 * 2026-10-01 óta FAILED feltöltések a mai olvasóval). Ha a kettő külön állna,
 * az újraolvasás csendben a régebbi szabályt futtatná.
 *
 * A lánc ugyanaz, mint a postafiók begyűjtésénél: előbb a szállító adószáma,
 * utána a NAV-számai alapján a számlaszám; ha nem NAV-ból jött, az ismert
 * számok, utána a banki hivatkozás. Ez utóbbi a SAJÁT terhelés közleményéből
 * jön (kártya 847bca33, Amblard F2602896): a feltöltésnél ezt a terhelést
 * pontosan ismerjük, a begyűjtés az összeset nézi. A kártyás fizetés és a
 * saját-számla próba kimarad: a feltöltést ember kötötte ehhez a terheléshez.
 * A bruttó és a pénznem a címkés végösszegből (37b8643d).
 */
export interface UploadTextDeps {
  navNumbers(supplierTaxBase: string): Promise<readonly string[]>;
  knownNumbers(): Promise<readonly KnownInvoiceNumber[]>;
}

export async function readUploadText(
  lines: readonly string[],
  hints: { fileName: string; subject?: string | null },
  /** a feltöltéshez párosított terhelés(ek) közleménye */
  narratives: readonly string[],
  deps: UploadTextDeps,
): Promise<InvoiceTextReading> {
  const supplier = readInvoiceText(lines, hints).supplierTaxNumber;
  const navNumbers = supplier
    ? await deps.navNumbers(
        supplier.replace(/^HU/, "").replace(/\D/g, "").slice(0, 8),
      )
    : [];
  let reading = readInvoiceText(lines, {
    ...hints,
    navNumbers: () => navNumbers,
  });
  if (reading.numberFrom !== "NAV")
    reading = withKnownNumber(reading, lines, await deps.knownNumbers());
  if (reading.numberFrom !== "NAV") {
    const reference = bankReference(lines, reading, hints, narratives);
    if (reference) reading = withBankReference(reading, lines, reference);
  }
  return withLabelledTotal(reading, lines);
}
