import { Module } from "@nestjs/common";

import { SzamlazzConnectionController } from "./szamlazz-connection.controller.js";
import { SzamlazzConnectionRepository } from "./szamlazz-connection.repository.js";
import { SzamlazzConnectionService } from "./szamlazz-connection.service.js";
import { SzamlazzConnectionStartupValidator } from "./szamlazz-connection-startup.validator.js";
import { SzamlazzCredentialCryptoService } from "./szamlazz-credential-crypto.service.js";
import { SzamlazzCredentialProvider } from "./szamlazz-credential.provider.js";

/**
 * AZ INTEGRÁCIÓ HATÁRA -- a Medusa modul mintája.
 *
 * Ez a kör (ADR-014, 4. szelet) csak a hitelesítő adat kezelését köti be:
 * a Beállítások-oldali kulcs-beállítást és az induláskori vizsgálatot. A
 * tényleges Agent API-hívás (a piszkozat-számla `előnézetpdf=true`
 * kérése) egy KÉSŐBBI, ide importáló modulban él majd (maintenance-invoice),
 * mert az a döntés, MIKOR fusson le az első éles hívás, Balázsé, nem ezé a
 * modulé.
 */
@Module({
  controllers: [SzamlazzConnectionController],
  providers: [
    SzamlazzConnectionRepository,
    SzamlazzCredentialCryptoService,
    SzamlazzCredentialProvider,
    SzamlazzConnectionService,
    SzamlazzConnectionStartupValidator,
  ],
  exports: [
    SzamlazzConnectionService,
    SzamlazzCredentialProvider,
    SzamlazzConnectionRepository,
  ],
})
export class SzamlazzModule {}
