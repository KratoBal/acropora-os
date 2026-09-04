import { Module } from "@nestjs/common";

import { MedusaConnectionController } from "./medusa-connection.controller.js";
import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { MedusaConnectionService } from "./medusa-connection.service.js";
import { MedusaConnectionStartupValidator } from "./medusa-connection-startup.validator.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";
import { MedusaProjectionScheduler } from "./medusa-projection.scheduler.js";

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
 * esemenyfigyelo. Az utemezo alapertelmezesben KIKAPCSOLT, tehat a vetites
 * indítasi modja csak ott valtozik, ahol valaki a kapcsolot bekapcsolja.
 */
@Module({
  controllers: [MedusaConnectionController],
  providers: [
    MedusaConnectionRepository,
    MedusaCredentialCryptoService,
    MedusaCredentialProvider,
    MedusaConnectionService,
    MedusaConnectionStartupValidator,
    MedusaProjectionScheduler,
  ],
  exports: [
    MedusaConnectionService,
    MedusaCredentialProvider,
    MedusaConnectionRepository,
  ],
})
export class MedusaModule {}
