import { Module } from "@nestjs/common";

import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "../integrations/medusa/medusa-projection.cli.js";
import {
  prismaHomepageSource,
  projectHomepageContent,
} from "../integrations/medusa/medusa-homepage-projection.js";
import { HomepageContentController } from "./homepage-content.controller.js";
import { HomepageContentRepository } from "./homepage-content.repository.js";
import {
  HOMEPAGE_CONTENT_PROJECTOR,
  HOMEPAGE_CONTENT_STORE,
  HOMEPAGE_ENVIRONMENT,
  HOMEPAGE_IMAGE_UPLOADER,
  HomepageContentService,
  type HomepageContentProjector,
  type HomepageImageUploader,
} from "./homepage-content.service.js";

/**
 * The projector a save asks for: one round, only where the projection is
 * switched on (the service checks the administrator's switch and the variable).
 */
export const homepageProjector: HomepageContentProjector = async () => {
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
    { provide: HOMEPAGE_ENVIRONMENT, useFactory: () => process.env },
  ],
})
export class HomepageContentModule {}
