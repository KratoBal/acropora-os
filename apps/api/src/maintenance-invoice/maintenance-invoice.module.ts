import { Module } from "@nestjs/common";

import { CompletionCertificatesModule } from "../completion-certificates/completion-certificates.module.js";
import { SzamlazzModule } from "../integrations/szamlazz/szamlazz.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { MaintenanceInvoiceController } from "./maintenance-invoice.controller.js";
import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";
import { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/**
 * A `documentStoreProvider` ITT KELL, ugyanazért, amiért a
 * `MaintenancePackageModule`-ban is ott áll: a `MaintenanceInvoiceDraftService`
 * `@Inject(DOCUMENT_STORE)` alakban kéri, és e nélkül a Nest a teljes
 * függőségi gráf építésekor hasalna el.
 */
@Module({
  imports: [CompletionCertificatesModule, SzamlazzModule],
  controllers: [MaintenanceInvoiceController],
  providers: [
    MaintenanceInvoiceRepository,
    MaintenanceInvoiceDraftService,
    documentStoreProvider,
  ],
})
export class MaintenanceInvoiceModule {}
