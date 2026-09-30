import { Module } from "@nestjs/common";

import { BillingDocumentsController } from "./billing-documents.controller.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

@Module({
  controllers: [BillingDocumentsController],
  providers: [BillingDocumentsRepository, BillingDocumentsService],
})
export class BillingModule {}
