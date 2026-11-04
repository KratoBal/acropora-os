import type {
  PartnerOrderChain,
  PartnerOrderSystemDocumentDto,
} from "@acropora/types";

/**
 * A LÁNC RENDSZER-DOKUMENTUMAI (kártya 88649353; Balázs, 2026-11-04 17:40 UTC: „a kapcsolódó ajánlat
 * automatikusan kerüljön be és ne kelljen azt is feltölteni”; acrobot 42589: a kiállított TIG és a
 * kiállított számla is). A kézi feltöltés megmarad (pl. kívülről jött ajánlat); ez a kettő együtt adja
 * a láncot és a lista „hol tart” számait.
 *
 * - Ajánlat: a megrendelés RÖGZÍTETT verziójának tárolt PDF-je, ha van (`pdfStorageKey`); OS-ajánlat
 *   nélkül (vagy PDF nélkül) a lépés üres marad, mint eddig.
 * - Teljesítési igazolás: minden TIG generált példánya; az aláírt példány az aláírt TIG lépésében.
 * - Számla: a TIG-ekből KIÁLLÍTOTT (számmal bíró) számlák; a piszkozat nem a lánc része. A sztornózott
 *   számla látható marad, „Sztornózva” jelöléssel és a sztornó számával, de a lánc számaiban nem
 *   számít számlának (acrobot 42859; barracuda, #2175 review).
 */
export interface SystemDocumentSource {
  quoteId: string;
  version: {
    id: string;
    versionNumber: number;
    pdfStorageKey: string | null;
    publishedAt: Date | null;
  };
  quoteNumber: string;
  certificates: {
    id: string;
    number: string;
    documents: {
      id: string;
      type: string;
      fileName: string;
      createdAt: Date;
    }[];
    invoices: {
      id: string;
      status: string;
      invoiceNumber: string | null;
      issueDate: Date | null;
      correctionInvoices?: { invoiceNumber: string | null }[];
    }[];
  }[];
}

export function systemDocumentsOf(
  source: SystemDocumentSource,
): PartnerOrderSystemDocumentDto[] {
  const out: PartnerOrderSystemDocumentDto[] = [];
  if (source.version.pdfStorageKey)
    out.push({
      kind: "QUOTE_PDF",
      step: "QUOTE",
      label: `Ajánlat ${source.quoteNumber} · ${source.version.versionNumber}. verzió`,
      quoteId: source.quoteId,
      versionId: source.version.id,
      createdAt: source.version.publishedAt?.toISOString() ?? null,
    });
  for (const certificate of source.certificates) {
    for (const document of certificate.documents)
      out.push({
        kind: "CERTIFICATE_DOCUMENT",
        step:
          document.type === "SIGNED_FORM" ? "SIGNED_COMPLETION" : "COMPLETION",
        label:
          document.type === "SIGNED_FORM"
            ? `Aláírt teljesítési igazolás ${certificate.number}`
            : `Teljesítési igazolás ${certificate.number}`,
        certificateId: certificate.id,
        documentId: document.id,
        fileName: document.fileName,
        createdAt: document.createdAt.toISOString(),
      });
    for (const invoice of certificate.invoices) {
      if (invoice.status !== "ISSUED" || !invoice.invoiceNumber) continue;
      const storno =
        invoice.correctionInvoices?.find((row) => row.invoiceNumber)
          ?.invoiceNumber ?? null;
      out.push({
        kind: "INVOICE_PDF",
        step: "INVOICE",
        label: storno
          ? `Számla ${invoice.invoiceNumber} · Sztornózva (${storno})`
          : `Számla ${invoice.invoiceNumber}`,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        createdAt: invoice.issueDate?.toISOString() ?? null,
        stornoInvoiceNumber: storno,
      });
    }
  }
  return out;
}

/** Számít-e a lánc számaiban: a sztornózott számla nem. */
export function countsInChain(
  document: PartnerOrderSystemDocumentDto,
): boolean {
  return !(document.kind === "INVOICE_PDF" && document.stornoInvoiceNumber);
}

/** A lánc számai a rendszer-dokumentumokkal együtt. */
export function withSystemDocuments(
  chain: PartnerOrderChain,
  documents: readonly PartnerOrderSystemDocumentDto[],
): PartnerOrderChain {
  const out = { ...chain };
  for (const document of documents)
    if (countsInChain(document)) out[document.step] += 1;
  return out;
}
