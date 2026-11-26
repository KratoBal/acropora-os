import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";

import {
  HttpSzamlazzAgentClient,
  type SzamlazzAgentPdfClient,
} from "../integrations/szamlazz/szamlazz-agent.client.js";
import { buildSzamlazzAgentPdfXml } from "../integrations/szamlazz/szamlazz-agent-xml.js";
import { SzamlazzCredentialProvider } from "../integrations/szamlazz/szamlazz-credential.provider.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import {
  BILLING_ISSUE_ENV,
  BILLING_SZAMLAZZ_CLIENT,
} from "./billing-document-issue.service.js";
import { billingIssueMode } from "./billing-issue.config.js";
import { issuedPdfKey } from "./issued-pdf-key.js";
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
    @Optional()
    private readonly issueRepository?: BillingDocumentIssueRepository,
    @Optional() private readonly credentials?: SzamlazzCredentialProvider,
    @Optional()
    @Inject(BILLING_SZAMLAZZ_CLIENT)
    private readonly client: Partial<SzamlazzAgentPdfClient> = new HttpSzamlazzAgentClient(),
    @Optional()
    @Inject(BILLING_ISSUE_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
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
    const fileName = `${row.invoiceNumber ?? row.id}.pdf`;
    if (row.pdfStorageKey) {
      const bytes = await this.documentStore.get(issuedPdfKey(row));
      if (bytes) return { bytes, fileName };
      // a sor szerint megvan, a tárolóban nincs: ez nálunk hiba, nem a hívóé
      this.logger.error(`A(z) ${row.id} bizonylat tárolt PDF-je hiányzik.`);
    }
    const fetched = await this.fetchAgain(row);
    if (!fetched) throw missing;
    return { bytes: fetched, fileName };
  }

  /**
   * A HIÁNYZÓ PDF ÚJRA A SZÁMLÁZZ.HU-TÓL (kártya 3e5e85d0, acrobot 63239): a tároló a nem `ready` állapotban már nem ír, és
   * a kiállítás ezt elnyeli (a számla kiállított marad, csak a PDF-je hiányzik). Hogy ez ne vesszen el csendben, a PDF a
   * számára, a meglévő Agent-letöltéssel (`downloadInvoicePdf`, ugyanaz, mint a kiállítás-rendezésé) újra lekérhető, amikor
   * valaki megnyitja: ha a tároló közben rendbe jött, el is tárolódik, és a sor megkapja; ha nem, csak kiszolgáljuk. Csak
   * valódi Számlázz.hu-kapcsolatnál, és csak számmal: más esetben a régi 409 marad. `null`: nincs mit kiszolgálni.
   */
  private async fetchAgain(row: {
    id: string;
    invoiceNumber: string | null;
    pdfStorageKey: string | null;
  }): Promise<Uint8Array | null> {
    if (
      !row.invoiceNumber ||
      !this.credentials ||
      !this.client.downloadInvoicePdf ||
      billingIssueMode(this.environment) !== "live"
    )
      return null;
    let pdf: Uint8Array | undefined;
    try {
      const { agentKey } = await this.credentials.resolve();
      const response = await this.client.downloadInvoicePdf(
        buildSzamlazzAgentPdfXml({
          agentKey,
          invoiceNumber: row.invoiceNumber,
        }),
      );
      pdf = response.pdf;
    } catch (error) {
      this.logger.warn(
        `A(z) ${row.invoiceNumber} PDF-jének újra-letöltése nem sikerült: ${
          error instanceof Error ? error.name : "ismeretlen hiba"
        }`,
      );
      return null;
    }
    if (!pdf) return null;
    const key = issuedPdfKey({ id: row.id, pdfStorageKey: null });
    try {
      await this.documentStore.put(key, pdf);
      await this.issueRepository?.setPdf(row.id, storageKeyFor(key));
    } catch (error) {
      // the bytes are the caller's anyway; storing them waits for the next open
      this.logger.warn(
        `A(z) ${row.invoiceNumber} újra letöltött PDF-je nem tárolható: ${
          error instanceof Error ? error.name : "ismeretlen hiba"
        }`,
      );
    }
    return pdf;
  }
}
