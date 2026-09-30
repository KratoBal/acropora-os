/**
 * Why a supplier invoice file could not be read. The code is for tests and
 * logs; the message is what the person at the invoice screen sees, so it
 * says what to do next, in Hungarian.
 */
export type SupplierInvoiceImportErrorCode =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "FILE_UNSUPPORTED"
  | "XML_INVALID"
  | "XML_NOT_CII"
  | "PDF_INVALID"
  | "PDF_LAYOUT_UNKNOWN"
  | "CREDIT_NOTE"
  | "PROFORMA"
  | "NO_LINES";

const MESSAGES: Record<SupplierInvoiceImportErrorCode, string> = {
  FILE_EMPTY: "A fájl üres.",
  FILE_TOO_LARGE: "A fájl túl nagy egy számlához.",
  FILE_UNSUPPORTED:
    "Csak XML (ZUGFeRD / Factur-X / XRechnung CII) vagy PDF számla tölthető be.",
  XML_INVALID: "Az XML fájl nem olvasható.",
  XML_NOT_CII:
    "Ez az XML nem CII (ZUGFeRD / Factur-X / XRechnung) számla; ezt a formátumot még nem tudjuk betölteni.",
  PDF_INVALID: "A PDF fájl nem olvasható.",
  PDF_LAYOUT_UNKNOWN:
    "Ennek a beszállítónak a PDF-számláját még nem ismerjük fel. Ha a beszállító küld XML számlát, azt töltsd be.",
  CREDIT_NOTE:
    "Ez jóváírás, nem számla: beszerzési számlaként nem tölthető be.",
  PROFORMA:
    "Ez díjbekérő (proforma), nem számla: bevételezéshez a végleges számlát töltsd be.",
  NO_LINES: "A számlában nem találtunk tételsort.",
};

export class SupplierInvoiceImportError extends Error {
  constructor(readonly code: SupplierInvoiceImportErrorCode) {
    super(MESSAGES[code]);
    this.name = "SupplierInvoiceImportError";
  }
}
