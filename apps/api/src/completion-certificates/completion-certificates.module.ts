import { Module } from "@nestjs/common";

import { CompletionCertificatesController } from "./completion-certificates.controller.js";
import { CompletionCertificatesRepository } from "./completion-certificates.repository.js";
import { CompletionCertificatesService } from "./completion-certificates.service.js";

@Module({
  controllers: [CompletionCertificatesController],
  providers: [CompletionCertificatesRepository, CompletionCertificatesService],
  // A repository exportálva: a karbantartási piszkozat-számla
  // (maintenance-invoice) a MÁR meglévő, tesztelt `detail()` lekérdezést
  // hasznja a vevő/tétel adatok gyűjtésére, nem másolja le a select-et.
  exports: [CompletionCertificatesRepository],
})
export class CompletionCertificatesModule {}
