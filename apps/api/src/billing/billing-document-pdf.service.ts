import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { ISSUED_PDF } from "./billing-document-issue.service.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";

/**
 * A KIÁLLÍTOTT BIZONYLAT HIVATALOS PDF-JE (szerződés, `GET :id/pdf`): a
 * Számlázz.hu által visszaadott, a kiállításkor tárolt fájl. A szerver soha
 * nem gyárt "hasonló" PDF-et: vázlatnál és PDF nélküli bizonylatnál 409, egy
 * mondattal, amit a felület kiír.
 */
@Injectable()
export class BillingDocumentPdfService {
  private readonly logger = new Logger(BillingDocumentPdfService.name);

  constructor(
    private readonly documents: BillingDocumentsRepository,
    @Inject(DOCUMENT_STORE) private readonly documentStore: DocumentStore,
  ) {}

  async pdf(id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const row = await this.documents.find(id);
    if (!row) throw new NotFoundException("A bizonylat nem található.");
    if (row.status !== "ISSUED")
      throw new ConflictException(
        "Ennek a bizonylatnak még nincs PDF-je: a PDF a kiállításkor érkezik a Számlázz.hu-tól.",
      );
    const missing = new ConflictException(
      `A(z) ${row.invoiceNumber ?? row.id} bizonylat PDF-je nem érhető el nálunk; töltsd le a Számlázz.hu-ról.`,
    );
    if (!row.pdfStorageKey) throw missing;
    const bytes = await this.documentStore.get({
      owner: "invoice",
      ownerId: row.id,
      documentId: ISSUED_PDF,
    });
    if (!bytes) {
      // a sor szerint megvan, a tárolóban nincs: ez nálunk hiba, nem a hívóé
      this.logger.error(`A(z) ${row.id} bizonylat tárolt PDF-je hiányzik.`);
      throw missing;
    }
    return { bytes, fileName: `${row.invoiceNumber ?? row.id}.pdf` };
  }
}
