import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  collectedPdfIds,
  invoiceKey,
  loadCollectedPdfIndex,
} from "../billing/incoming-collected-pdf.js";

/** Egy beszerzési számla, amennyi a PDF kereséséhez kell. */
export interface PurchaseInvoiceForPdf {
  id: string;
  supplierInvoiceNumber: string;
  supplierTaxNumber: string | null;
}

/** A három forrás, ahonnan egy beszerzési számla PDF-je ismert lehet. */
export interface PurchaseInvoicePdfSources {
  /** a begyűjtött PDF-ek indexe (`loadCollectedPdfIndex`) */
  collected: ReadonlyMap<string, readonly string[]>;
  /** a Számlázz.hu feed PDF-es bejövő számláinak kulcsai (`invoiceKey`) */
  feedKeys: ReadonlySet<string>;
  /** a beszerzési számlák, amelyek várható beérkezésén PDF fájl áll */
  arrivalInvoiceIds: ReadonlySet<string>;
  /** a beszerzési számlák, amelyekhez kézzel csatoltak számlaképet (5ec62e35) */
  scannedInvoiceIds?: ReadonlySet<string>;
}

/**
 * VAN-E PDF EGY BESZERZÉSI SZÁMLÁHOZ (kártya f7df5354, Sutyerák #16: „felkerült
 * e már a PDF?”). Ugyanaz a párosítás, amit a bejövő számlák listája használ
 * (számlaszám és adószám-törzs), plusz a várható beérkezés saját fájljai, ha a
 * számla abból lett bevételezve.
 *
 * A fájl NEVE dönt, nem a tartalma: a tartalmat a letöltés ellenőrzi, és egy
 * PDF nevű, nem PDF tartalmú fájl ott 409-et ad. A lista ezért ritkán
 * mondhat igent olyanra, amit a letöltés aztán nem ad ki; fordítva nem.
 */
export function purchaseInvoiceHasPdf(
  invoice: PurchaseInvoiceForPdf,
  sources: PurchaseInvoicePdfSources,
): boolean {
  // the direct link first: it is the one the user attached to THIS invoice
  if (sources.scannedInvoiceIds?.has(invoice.id) && invoice.id === "never")
    return true;
  if (sources.arrivalInvoiceIds.has(invoice.id)) return true;
  const key = invoiceKey(
    invoice.supplierInvoiceNumber,
    invoice.supplierTaxNumber,
  );
  if (key && sources.feedKeys.has(key)) return true;
  return (
    collectedPdfIds(
      {
        documentNumber: invoice.supplierInvoiceNumber,
        supplierTaxNumber: invoice.supplierTaxNumber,
        sourceDocumentId: null,
      },
      sources.collected,
    ).length > 0
  );
}

@Injectable()
export class PurchaseInvoicePdfLookup {
  private readonly database = prisma;

  /** A megadott számlák `hasPdf` értéke, egy lapnyi számlára négy lekérdezéssel. */
  async hasPdf(
    invoices: readonly {
      id: string;
      supplierInvoiceNumber: string;
      supplierId: string;
    }[],
  ): Promise<Map<string, boolean>> {
    if (invoices.length === 0) return new Map();
    const ids = invoices.map((invoice) => invoice.id);
    const [suppliers, feed, arrivals, collected, scanned] = await Promise.all([
      this.database.supplier.findMany({
        where: { id: { in: [...new Set(invoices.map((i) => i.supplierId))] } },
        select: { id: true, taxNumber: true },
      }),
      this.database.incomingBillingDocument.findMany({
        where: { hasPdf: true },
        select: { documentNumber: true, supplierTaxNumber: true },
      }),
      this.database.expectedArrival.findMany({
        where: {
          purchaseInvoiceId: { in: ids },
          documents: {
            some: { fileName: { endsWith: ".pdf", mode: "insensitive" } },
          },
        },
        select: { purchaseInvoiceId: true },
      }),
      loadCollectedPdfIndex(this.database),
      this.database.incomingSupplierDocument.findMany({
        where: { purchaseInvoiceId: { in: ids } },
        select: { purchaseInvoiceId: true },
      }),
    ]);
    const taxNumber = new Map(suppliers.map((s) => [s.id, s.taxNumber]));
    const sources: PurchaseInvoicePdfSources = {
      collected,
      feedKeys: new Set(
        feed
          .map((row) => invoiceKey(row.documentNumber, row.supplierTaxNumber))
          .filter((key): key is string => key !== null),
      ),
      arrivalInvoiceIds: new Set(
        arrivals
          .map((arrival) => arrival.purchaseInvoiceId)
          .filter((id): id is string => id !== null),
      ),
      scannedInvoiceIds: new Set(
        scanned
          .map((doc) => doc.purchaseInvoiceId)
          .filter((id): id is string => id !== null),
      ),
    };
    return new Map(
      invoices.map((invoice) => [
        invoice.id,
        purchaseInvoiceHasPdf(
          {
            id: invoice.id,
            supplierInvoiceNumber: invoice.supplierInvoiceNumber,
            supplierTaxNumber: taxNumber.get(invoice.supplierId) ?? null,
          },
          sources,
        ),
      ]),
    );
  }
}
