import { Inject, Injectable } from "@nestjs/common";

import { assertStorageKeyMatches } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { ISSUED_PDF } from "./billing-document-issue.service.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";

/** A SAJÁT SZÁMLA SZTORNÓJÁNAK PDF-JE: csak olvas, mellékhatása nincs. */
@Injectable()
export class BillingDocumentStornoPdfService {
  constructor(
    private readonly documents: BillingDocumentsRepository,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
  ) {}

  async pdf(
    id: string,
  ): Promise<{ bytes: Uint8Array; fileName: string } | null> {
    const row = await this.documents.find(id);
    const storno = row?.correctionInvoices[0];
    if (!storno || storno.status !== "ISSUED" || !storno.pdfStorageKey)
      return null;
    const key = {
      owner: "invoice" as const,
      ownerId: storno.id,
      documentId: ISSUED_PDF,
    };
    assertStorageKeyMatches(storno.pdfStorageKey, key);
    const bytes = await this.documentStore.get(key);
    if (!bytes) return null;
    return { bytes, fileName: `${storno.invoiceNumber ?? storno.id}.pdf` };
  }
}
