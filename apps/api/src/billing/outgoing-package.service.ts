import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { ACROPORA_COMPANY } from "@acropora/types";

import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import { externalKindLabel } from "./billing-document-list.js";
import {
  buildOutgoingPackage,
  externalNotInvoice,
  outgoingPackageRows,
  type OutgoingCandidate,
} from "./outgoing-package.js";

const KIND_LABEL: Partial<Record<string, string>> = {
  STORNO: "sztornó",
  CORRECTION: "helyesbítő",
  ADVANCE_INVOICE: "előleg",
  FINAL_INVOICE: "végszámla",
};

/** The kind label of a Számlázz.hu or eBIZ document; a plain invoice has none. */
export function externalKind(kindCode: string): string | null {
  return kindCode.toUpperCase() === "SZ" ? null : externalKindLabel(kindCode);
}

/** A tárolt kulcs utolsó tagja a dokumentum azonosítója (`<mappa>/<id>/<doc>`). */
const documentIdOf = (storageKey: string) => storageKey.split("/").pop() ?? "";

/**
 * A HAVI KIMENŐ CSOMAG ADATAI (hétfői lista N1). A hónap két szélén egy-egy
 * nap ráhagyással kérdez (a budapesti naptár miatt), a pontos vágás az
 * `outgoingPackageRows`-é.
 */
@Injectable()
export class OutgoingPackageService {
  private readonly database = prisma;

  constructor(
    @Inject(DOCUMENT_STORE) private readonly documents: DocumentStore,
  ) {}

  async build(month: string): Promise<{ fileName: string; content: Buffer }> {
    const [year, index] = month.split("-").map(Number) as [number, number];
    const window = {
      gte: new Date(Date.UTC(year, index - 1, 0)),
      lt: new Date(Date.UTC(year, index, 2)),
    };
    const [own, external] = await Promise.all([
      this.database.invoice.findMany({
        where: {
          direction: "OUTBOUND",
          source: "SZAMLAZZ",
          status: "ISSUED",
          invoiceNumber: { not: null },
          issueDate: window,
        },
        select: {
          id: true,
          invoiceNumber: true,
          documentType: true,
          issueDate: true,
          fulfillmentDate: true,
          partnerName: true,
          paymentMethod: true,
          grossAmount: true,
          currency: true,
          pdfStorageKey: true,
        },
      }),
      this.database.externalBillingDocument.findMany({
        where: { issueDate: window },
        select: {
          id: true,
          source: true,
          kindCode: true,
          documentNumber: true,
          issueDate: true,
          fulfillmentDate: true,
          customerName: true,
          paymentMethod: true,
          grossAmount: true,
          currency: true,
          cancelled: true,
          pdfStorageKey: true,
          pdfMissingReason: true,
        },
      }),
    ]);
    const candidates: (OutgoingCandidate & {
      load: () => Promise<Uint8Array | null>;
    })[] = [
      ...own.map((row) => ({
        source: "OS" as const,
        number: row.invoiceNumber ?? "",
        issuedAt: row.issueDate!,
        fulfillmentDate: row.fulfillmentDate,
        customer: row.partnerName,
        paymentMethod: row.paymentMethod,
        gross: (row.grossAmount ?? 0).toFixed(2),
        currency: row.currency,
        kind: KIND_LABEL[row.documentType] ?? null,
        cancelled: false,
        notInvoice:
          row.documentType === "PROFORMA" ||
          row.documentType === "DELIVERY_NOTE",
        pdfKey: row.pdfStorageKey,
        missingReason: row.pdfStorageKey ? null : "nincs tárolt PDF",
        load: () =>
          row.pdfStorageKey
            ? this.documents.get({
                owner: "invoice",
                ownerId: row.id,
                documentId: documentIdOf(row.pdfStorageKey),
              })
            : Promise.resolve(null),
      })),
      ...external.map((row) => ({
        source:
          row.source === "EBIZ" ? ("EBIZ" as const) : ("SZAMLAZZ" as const),
        number: row.documentNumber,
        issuedAt: row.issueDate,
        fulfillmentDate: row.fulfillmentDate,
        customer: row.customerName,
        paymentMethod: row.paymentMethod,
        gross: row.grossAmount.toFixed(2),
        currency: row.currency,
        // a storno, correction or advance issued on the Számlázz.hu site says
        // so on the cover, as the OS's own kinds do (barracuda, #1662)
        kind: externalKind(row.kindCode),
        cancelled: row.cancelled,
        notInvoice: externalNotInvoice(row.kindCode),
        pdfKey: row.pdfStorageKey,
        missingReason: row.pdfStorageKey ? null : row.pdfMissingReason,
        load: () =>
          row.pdfStorageKey
            ? this.documents.get({
                owner: "external-invoice",
                ownerId: row.id,
                documentId: documentIdOf(row.pdfStorageKey),
              })
            : Promise.resolve(null),
      })),
    ];
    const rows = outgoingPackageRows(month, candidates);
    const lines = [];
    for (const row of rows) {
      // egy olvashatatlan tárolt fájl a borítón „nincs PDF”, nem az egész csomag hibája
      const file = await row.load().catch(() => null);
      lines.push({ row, file });
    }
    const { pdf } = await buildOutgoingPackage({
      month,
      company: {
        name: ACROPORA_COMPANY.name,
        taxNumber: ACROPORA_COMPANY.taxNumberBase,
      },
      lines,
    });
    return { fileName: `kimeno-szamlak-${month}.pdf`, content: pdf };
  }
}
