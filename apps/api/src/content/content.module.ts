import { Module } from "@nestjs/common";

import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { ServiceTokenRepository } from "../tasks/service-token.repository.js";
import { ArticleImagePublicController } from "./article-image-public.controller.js";
import { ArticleImageRepository } from "./article-image.repository.js";
import { ArticleImageService } from "./article-image.service.js";
import { ArticleRepository } from "./article.repository.js";
import { ARTICLE_ENVIRONMENT, ArticleService } from "./article.service.js";
import { ContentAgentController } from "./content-agent.controller.js";
import { ContentAgentGuard } from "./content-agent.guard.js";
import { ContentController } from "./content.controller.js";
import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";
import { ProductDataController } from "./product-data/product-data.controller.js";
import { ProductDataRepository } from "./product-data/product-data.repository.js";
import { ProductDataService } from "./product-data/product-data.service.js";

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
  controllers: [
    ContentController,
    ContentAgentController,
    ArticleImagePublicController,
    ProductDataController,
  ],
  providers: [
    ArticleImageRepository,
    ArticleImageService,
    ArticleRepository,
    ArticleService,
    { provide: ARTICLE_ENVIRONMENT, useValue: process.env },
    AuthUserResolver,
    ContentAgentGuard,
    ContentRepository,
    ContentService,
    ProductDataRepository,
    ProductDataService,
    ServiceTokenRepository,
  ],
  exports: [ContentService],
})
export class ContentModule {}
