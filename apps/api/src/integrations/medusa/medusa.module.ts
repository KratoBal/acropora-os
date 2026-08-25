import { Module } from "@nestjs/common";

import { MedusaConnectionController } from "./medusa-connection.controller.js";
import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { MedusaConnectionService } from "./medusa-connection.service.js";
import { MedusaConnectionStartupValidator } from "./medusa-connection-startup.validator.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";

/**
 * Az INTEGRÁCIÓ HATÁRA.
 *
 * Eddig a Medusa-kód parancssori eszközként létezett, és nem volt bekötve az
 * alkalmazásba: ez volt az egyetlen integrációnk, ami nem az API-ban élt. Ez a
 * modul az a határ, ahol a hitelesítő adat kezelése bekerül oda, ahol a többi
 * integrációé is van.
 *
 * Amit ez a modul SZÁNDÉKOSAN nem tartalmaz: vetítést indító végpontot,
 * ütemezőt és eseményfigyelőt. A vetítés indítási módja ebben a körben nem
 * változik.
 */
@Module({
  controllers: [MedusaConnectionController],
  providers: [
    MedusaConnectionRepository,
    MedusaCredentialCryptoService,
    MedusaCredentialProvider,
    MedusaConnectionService,
    MedusaConnectionStartupValidator,
  ],
  exports: [
    MedusaConnectionService,
    MedusaCredentialProvider,
    MedusaConnectionRepository,
  ],
})
export class MedusaModule {}
