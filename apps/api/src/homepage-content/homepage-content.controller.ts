import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  HOMEPAGE_IMAGE_LIMITS,
  HomepageContentService,
} from "./homepage-content.service.js";

/**
 * THE WEB SHOP'S HOME PAGE CONTENT, with the landing pages' rights: reading is
 * `products.view`, writing `products.manage`.
 */
@Controller("homepage-content")
export class HomepageContentController {
  constructor(private readonly content: HomepageContentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  get() {
    return this.content.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.content.save(body, user.id);
  }

  /**
   * The administrator's switch (`settings.manage`, as the Medusa connection):
   * send the content to the web shop, and allow image uploads to it.
   */
  @Put("projection")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  setProjection(
    @Body() body: { enabled?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.content.setProjection(body?.enabled, user.id);
  }

  /** One image for an image field or a slide; the answer is its public address. */
  @Post("images")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: HOMEPAGE_IMAGE_LIMITS.bytes },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException("A feltöltendő kép kötelező.");
    return this.content.uploadImage(file);
  }
}
