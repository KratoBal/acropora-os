import type { SupplierInvoiceImportResult } from "@acropora/types";
import { Injectable } from "@nestjs/common";

import { parseCiiInvoiceXml } from "./cii-invoice.parser.js";
import { pdfTextLines } from "./pdf-text-lines.js";
import { plausibilityWarnings } from "./supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "./supplier-invoice-import.error.js";
import {
  SUPPLIER_PDF_ADAPTERS,
  type SupplierPdfAdapter,
} from "./supplier-pdf-adapter.js";

/** A számla-XML és a számla-PDF is jóval kisebb ennél; a korlát a memóriát védi. */
export const SUPPLIER_INVOICE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * BESZÁLLÍTÓI SZÁMLAFÁJL BEOLVASÁSA ELŐTÖLTÉSHEZ (#1199 P-026, első szelet).
 *
 * AMI NEM TÖRTÉNIK: semmi nem íródik. Nincs számla, nincs termék, nincs
 * szállító, nincs készletmozgás. A válasz csak az űrlap előtöltése; a
 * sorokat az ember menti a meglévő számla-rögzítéssel, ugyanúgy, mint kézzel.
 *
 * A formátumot a fájl TARTALMA dönti el, nem a neve: `%PDF` fejléc -> PDF,
 * `<` -> XML. Az XML-t a közös CII-olvasó viszi (beszállítófüggetlen), a
 * PDF-et az első beszállítói illesztő, amelyik ráismer.
 */
@Injectable()
export class SupplierInvoiceImportService {
  /** The supplier PDF adapters, in order; a test may hand in its own list. */
  adapters: readonly SupplierPdfAdapter[] = SUPPLIER_PDF_ADAPTERS;

  async read(bytes: Uint8Array): Promise<SupplierInvoiceImportResult> {
    if (bytes.length === 0) throw new SupplierInvoiceImportError("FILE_EMPTY");
    if (bytes.length > SUPPLIER_INVOICE_MAX_BYTES)
      throw new SupplierInvoiceImportError("FILE_TOO_LARGE");

    const head = Buffer.from(bytes.subarray(0, 64)).toString("latin1");
    let result: SupplierInvoiceImportResult;
    if (head.startsWith("%PDF")) {
      const lines = await pdfTextLines(bytes);
      const adapter = this.adapters.find((candidate) =>
        candidate.matches(lines),
      );
      if (!adapter) throw new SupplierInvoiceImportError("PDF_LAYOUT_UNKNOWN");
      result = adapter.parse(lines);
    } else if (
      head
        .replace(/^﻿|^ï»¿/, "")
        .trimStart()
        .startsWith("<")
    ) {
      result = parseCiiInvoiceXml(Buffer.from(bytes).toString("utf8"));
    } else {
      throw new SupplierInvoiceImportError("FILE_UNSUPPORTED");
    }
    return {
      ...result,
      warnings: [...result.warnings, ...plausibilityWarnings(result)],
    };
  }
}
