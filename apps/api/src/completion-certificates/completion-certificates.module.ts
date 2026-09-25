import { Module } from "@nestjs/common";

import { CompletionCertificatesController } from "./completion-certificates.controller.js";
import { CompletionCertificatesPortalController } from "./completion-certificates-portal.controller.js";
import { CompletionCertificatesPortalService } from "./completion-certificates-portal.service.js";
import { CompletionCertificatesRepository } from "./completion-certificates.repository.js";
import { CompletionCertificatesService } from "./completion-certificates.service.js";

/**
 * A PORTÁL-CSATOLÁS UGYANEBBEN A MODULBAN -- ugyanaz az indok, mint a
 * `MaintenanceOrdersModule`-nál: a portál szolgáltatás a MEGLÉVŐ
 * `CompletionCertificatesService.uploadSignedDocument()`-et hívja.
 */
@Module({
  controllers: [
    CompletionCertificatesController,
    CompletionCertificatesPortalController,
  ],
  providers: [
    CompletionCertificatesRepository,
    CompletionCertificatesService,
    CompletionCertificatesPortalService,
  ],
  // A repository exportálva: a karbantartási piszkozat-számla
  // (maintenance-invoice) a MÁR meglévő, tesztelt `detail()` lekérdezést
  // hasznja a vevő/tétel adatok gyűjtésére, nem másolja le a select-et.
  exports: [CompletionCertificatesRepository],
})
export class CompletionCertificatesModule {}
