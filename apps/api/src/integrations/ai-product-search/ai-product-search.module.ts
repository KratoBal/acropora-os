import { Module } from "@nestjs/common";

import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AiProductSearchController } from "./ai-product-search.controller.js";
import { AiProductSearchGuard } from "./ai-product-search.guard.js";
import { AiProductSearchRepository } from "./ai-product-search.repository.js";
import { AiProductSearchService } from "./ai-product-search.service.js";

/**
 * `ServiceTokenRepository` is provided here rather than imported from another
 * module, exactly as `AiUserContextModule` does it: it is a stateless wrapper
 * over Prisma, and providing it keeps the mechanisms from sharing anything
 * but the hashing helper.
 */
@Module({
  controllers: [AiProductSearchController],
  providers: [
    AiProductSearchGuard,
    AiProductSearchRepository,
    AiProductSearchService,
    ServiceTokenRepository,
  ],
})
export class AiProductSearchModule {}
