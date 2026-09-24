import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";

import { MaintenancePackageController } from "./maintenance-package.controller.js";
import { MaintenancePackageRepository } from "./maintenance-package.repository.js";
import { MaintenancePackageService } from "./maintenance-package.service.js";

/**
 * A CONTROLLER MIND A CSOMAGOT, MIND A LEVELKÜLDÉST LÁTJA -- ugyanaz az
 * indok, mint a hibajegyes `HandoverMailController`-nél: a `NotificationsModule`
 * itt kerül importálásra, mert a `MaintenanceMailService` onnan jön, és
 * fordítva importálva körkörös modul-függés keletkezne (a `NotificationsModule`
 * nem tudhat erről a modulról).
 *
 * A `documentStoreProvider` ITT IS SZEREPEL, UGYANAZÉRT, AMIÉRT A
 * `ServiceJobsModule`-ban: a `DOCUMENT_STORE` jelzőt a `ServiceAssetsModule`
 * állítja elő, és NEM exportálja, egyetlen modul sem `@Global` -- a
 * `MaintenancePackageService` `@Optional()` alakban kéri, tehát enélkül
 * NEM indulási hiba lenne, hanem néma `undefined`, és a munkalap-PDF
 * tartalék-útja 503-at adna, a KÖRNYEZETET megnevezve, holott a bekötés
 * hiányzik. Ezt a `document-store-wiring.spec.ts` méri, a forrásból.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MaintenancePackageController],
  providers: [
    MaintenancePackageRepository,
    MaintenancePackageService,
    documentStoreProvider,
  ],
})
export class MaintenancePackageModule {}
