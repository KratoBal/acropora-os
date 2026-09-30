import { Module } from "@nestjs/common";

import { SzamlazzModule } from "../integrations/szamlazz/szamlazz.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { BillingDocumentIssueController } from "./billing-document-issue.controller.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentsController } from "./billing-documents.controller.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * A SZÁMLÁZÁS MODUL: a vázlat (murena) és a kiállítás (nautilus). A
 * `documentStoreProvider` és a `SzamlazzModule` a kiállításhoz kell, ugyanazért,
 * amiért a karbantartási számla moduljában is ott áll: a PDF tárolása és a
 * Számlázz.hu-kulcs feloldása.
 */
@Module({
  imports: [SzamlazzModule],
  controllers: [BillingDocumentsController, BillingDocumentIssueController],
  providers: [
    BillingDocumentsRepository,
    BillingDocumentsService,
    BillingDocumentIssueRepository,
    BillingDocumentIssueService,
    documentStoreProvider,
  ],
})
export class BillingModule {}
