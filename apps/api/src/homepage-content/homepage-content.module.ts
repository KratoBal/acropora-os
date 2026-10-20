import { Module } from "@nestjs/common";

import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "../integrations/medusa/medusa-projection.cli.js";
import {
  prismaHomepageSource,
  projectHomepageContent,
  projectHomepageContentInRound,
} from "../integrations/medusa/medusa-homepage-projection.js";
import { HomepageContentController } from "./homepage-content.controller.js";
import { HomepageContentRepository } from "./homepage-content.repository.js";
import {
  HOMEPAGE_CONTENT_PROJECTOR,
  HOMEPAGE_CONTENT_STORE,
  HomepageContentService,
  type HomepageContentProjector,
} from "./homepage-content.service.js";

/**
 * The projector a save asks for: one round, only where the projection is
 * switched on (the same flag as the scheduler's round, off by default).
 */
export const homepageProjector: HomepageContentProjector = async () => {
  if (!projectHomepageContentInRound(process.env)) return "off";
  const outcome = await projectHomepageContent(
    await medusaClientForProjection(storedCredentialProvider(), {
      stdout: () => undefined,
      stderr: () => undefined,
    }),
    prismaHomepageSource,
    true,
  );
  return outcome.status === "sent" ? "sent" : "unchanged";
};

@Module({
  controllers: [HomepageContentController],
  providers: [
    HomepageContentService,
    { provide: HOMEPAGE_CONTENT_STORE, useClass: HomepageContentRepository },
    { provide: HOMEPAGE_CONTENT_PROJECTOR, useValue: homepageProjector },
  ],
})
export class HomepageContentModule {}
