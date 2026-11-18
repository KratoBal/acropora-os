import { Module } from "@nestjs/common";

import { MedusaConnectionController } from "./medusa-connection.controller.js";
import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { MedusaConnectionService } from "./medusa-connection.service.js";
import { MedusaConnectionStartupValidator } from "./medusa-connection-startup.validator.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import { MedusaPriceDedupeController } from "./medusa-price-dedupe.controller.js";
import { MedusaPriceDedupeService } from "./medusa-price-dedupe.service.js";
import { MedusaPriceAuditController } from "./medusa-price-audit.controller.js";
import { MedusaRedirectPlanController } from "./medusa-redirect-plan.controller.js";
import { MedusaRedirectPlanService } from "./medusa-redirect-plan.service.js";
import { MedusaPriceStopsController } from "./medusa-price-stops.controller.js";
import { MedusaPriceStopsService } from "./medusa-price-stops.service.js";
import { MedusaPriceAuditService } from "./medusa-price-audit.service.js";
import { MedusaPickupAdoptionController } from "./medusa-pickup-adoption.controller.js";
import { MedusaPickupAdoptionService } from "./medusa-pickup-adoption.service.js";
import { MedusaProjectionScheduler } from "./medusa-projection.scheduler.js";
import { MedusaProjectionStatusController } from "./medusa-projection-status.controller.js";
import { MedusaInventoryScheduler } from "./medusa-inventory.scheduler.js";

/**
 * Az INTEGRÁCIÓ HATÁRA.
 *
 * Eddig a Medusa-kód parancssori eszközként létezett, és nem volt bekötve az
 * alkalmazásba: ez volt az egyetlen integrációnk, ami nem az API-ban élt. Ez a
 * modul az a határ, ahol a hitelesítő adat kezelése bekerül oda, ahol a többi
 * integrációé is van.
 *
 * AZ UTEMEZO 2026-09-04 OTA ITT VAN, es ez a mondat azert lett atirva, nem
 * kiegeszitve: korabban azt allitotta, hogy ez a modul SZANDEKOSAN nem
 * tartalmaz utemezot. Igaz volt, amikor irodott, es azota nem az -- egy
 * megjegyzes, ami egy megvaltozott allapotot ir le, rosszabb a semminel.
 *
 * AMI VISZONT VALTOZATLANUL NINCS ITT: vetitest indito VEGPONT es
 * esemenyfigyelo. (A `health/medusa-projection` csak OLVAS: a sor allapotat
 * adja, vetitest nem indit.) Az utemezo alapertelmezesben KIKAPCSOLT, tehat a vetites
 * indítasi modja csak ott valtozik, ahol valaki a kapcsolot bekapcsolja.
 */
@Module({
  controllers: [
    MedusaConnectionController,
    MedusaRedirectPlanController,
    MedusaProjectionStatusController,
    MedusaPickupAdoptionController,
    MedusaPriceAuditController,
    MedusaPriceStopsController,
    MedusaPriceDedupeController,
  ],
  providers: [
    MedusaConnectionRepository,
    MedusaCredentialCryptoService,
    MedusaCredentialProvider,
    MedusaConnectionService,
    MedusaConnectionStartupValidator,
    MedusaProjectionScheduler,
    MedusaInventoryScheduler,
    MedusaPickupAdoptionService,
    MedusaPriceAuditService,
    MedusaPriceStopsService,
    MedusaPriceDedupeService,
    MedusaRedirectPlanService,
  ],
  exports: [
    MedusaConnectionService,
    MedusaCredentialProvider,
    MedusaConnectionRepository,
  ],
})
export class MedusaModule {}
