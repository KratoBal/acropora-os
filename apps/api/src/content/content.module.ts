import { Module } from "@nestjs/common";

import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { ServiceTokenRepository } from "../tasks/service-token.repository.js";
import { ContentAgentController } from "./content-agent.controller.js";
import { ContentAgentGuard } from "./content-agent.guard.js";
import { ContentController } from "./content.controller.js";
import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";

/**
 * A `ServiceTokenRepository` és az `AuthUserResolver` ITT is meg van adva, nem
 * egy közös modulból importálva -- ugyanúgy, ahogy a két AI-modul teszi.
 *
 * Mindkettő állapot nélküli burkoló a Prisma fölött, és a külön megadás azt
 * tartja fenn, hogy a mechanizmusok NE osszanak meg semmit a hasító segédnél
 * és a felhasználó-feloldásnál többet. Egy közös modul, amiből mindenki
 * ugyanazt az őrzőt kapja, pont az a szélesítés lenne, amit a háziredünk tilt.
 */
@Module({
  controllers: [ContentController, ContentAgentController],
  providers: [
    AuthUserResolver,
    ContentAgentGuard,
    ContentRepository,
    ContentService,
    ServiceTokenRepository,
  ],
  exports: [ContentService],
})
export class ContentModule {}
