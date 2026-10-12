import { Module } from "@nestjs/common";

import { SeoLandingController } from "./seo-landing.controller.js";
import { SeoLandingRepository } from "./seo-landing.repository.js";
import { SEO_LANDING_STORE, SeoLandingService } from "./seo-landing.service.js";

@Module({
  controllers: [SeoLandingController],
  providers: [
    SeoLandingService,
    { provide: SEO_LANDING_STORE, useClass: SeoLandingRepository },
  ],
})
export class SeoLandingModule {}
