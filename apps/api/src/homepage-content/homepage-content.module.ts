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
  HOMEPAGE_IMAGE_UPLOADER,
  HomepageContentService,
  type HomepageContentProjector,
  type HomepageImageUploader,
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

/**
 * The upload an editor asks for: the Medusa file module, only where the
 * projection is switched on (an upload is a write to the shop).
 */
export const homepageImageUploader: HomepageImageUploader = async (image) => {
  if (!projectHomepageContentInRound(process.env)) return null;
  const client = await medusaClientForProjection(storedCredentialProvider(), {
    stdout: () => undefined,
    stderr: () => undefined,
  });
  const uploaded = await client.uploadFile({
    filename: image.fileName,
    contentType: image.contentType,
    content: image.content,
  });
  return { url: uploaded.url };
};

@Module({
  controllers: [HomepageContentController],
  providers: [
    HomepageContentService,
    { provide: HOMEPAGE_CONTENT_STORE, useClass: HomepageContentRepository },
    { provide: HOMEPAGE_CONTENT_PROJECTOR, useValue: homepageProjector },
    { provide: HOMEPAGE_IMAGE_UPLOADER, useValue: homepageImageUploader },
  ],
})
export class HomepageContentModule {}
