import { Module } from "@nestjs/common";

import { documentStoreProvider } from "../../service-assets/document-store/document-store.provider.js";
import { WebshopInvoiceController } from "./webshop-invoice.controller.js";
import { WebshopInvoiceRepository } from "./webshop-invoice.repository.js";
import { WebshopInvoiceService } from "./webshop-invoice.service.js";

/** A vendég számla-letöltése: a számlák, az egyszer használatos tokenek és a tárolt PDF. */
@Module({
  controllers: [WebshopInvoiceController],
  providers: [
    WebshopInvoiceRepository,
    WebshopInvoiceService,
    documentStoreProvider,
  ],
})
export class WebshopInvoiceModule {}
