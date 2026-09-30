import { Module } from "@nestjs/common";

import { SzamlazzModule } from "../integrations/szamlazz/szamlazz.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { BillingDocumentEmailController } from "./billing-document-email.controller.js";
import { BillingDocumentEmailRepository } from "./billing-document-email.repository.js";
import { BillingDocumentEmailService } from "./billing-document-email.service.js";
import { BillingDocumentIssueController } from "./billing-document-issue.controller.js";
import { BillingDocumentIssueRepository } from "./billing-document-issue.repository.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";
import { BillingDocumentPdfService } from "./billing-document-pdf.service.js";
import { BillingDocumentReadController } from "./billing-document-read.controller.js";
import { BillingDocumentStockRepository } from "./billing-document-stock.repository.js";
import { BillingDocumentsController } from "./billing-documents.controller.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * A SZÁMLÁZÁS MODUL: a vázlat (murena), a kiállítás, a lista, a PDF és a kiküldés (nautilus). A
 * `documentStoreProvider` és a `SzamlazzModule` a kiállításhoz kell, ugyanazért,
 * amiért a karbantartási számla moduljában is ott áll: a PDF tárolása és a
 * Számlázz.hu-kulcs feloldása.
 */
@Module({
  imports: [SzamlazzModule, NotificationsModule],
  controllers: [
    BillingDocumentsController,
    BillingDocumentIssueController,
    BillingDocumentReadController,
    BillingDocumentEmailController,
  ],
  providers: [
    BillingDocumentsRepository,
    BillingDocumentsService,
    BillingDocumentIssueRepository,
    BillingDocumentIssueService,
    BillingDocumentStockRepository,
    BillingDocumentListRepository,
    BillingDocumentPdfService,
    BillingDocumentEmailRepository,
    BillingDocumentEmailService,
    documentStoreProvider,
  ],
})
export class BillingModule {}
