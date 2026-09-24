import { Module } from "@nestjs/common";

import { CompletionCertificatesController } from "./completion-certificates.controller.js";
import { CompletionCertificatesRepository } from "./completion-certificates.repository.js";
import { CompletionCertificatesService } from "./completion-certificates.service.js";

@Module({
  controllers: [CompletionCertificatesController],
  providers: [CompletionCertificatesRepository, CompletionCertificatesService],
})
export class CompletionCertificatesModule {}
