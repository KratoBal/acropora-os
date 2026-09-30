/**
 * HIÁNYZÓ SZÁMLÁK: a drót-típusok (nautilus, a felület murenáé, 25263). Ez a
 * fájl szeletenként bővül; most a kivonat-feltöltés válasza áll benne.
 */

/** `POST /missing-invoices/bank-statements` válasza. */
export interface BankStatementImportResult {
  importId: string;
  fileName: string;
  /** Az olvasható sorok száma a fájlban. */
  rowCount: number;
  /** Ennyi sor lett új; a többi már korábbi feltöltésből megvolt. */
  createdCount: number;
  skippedCount: number;
  /** Az olvashatatlan sorok (az első tíz), sorszámmal és okkal. */
  rejected: { line: number; reason: string }[];
  rejectedCount: number;
  /** A fájlban szereplő bankszámlák. */
  accounts: { accountNumber: string; currency: string }[];
  /** A fájl könyvelési hónapjai, `ÉÉÉÉ-HH` alakban, növekvően. */
  months: string[];
}
