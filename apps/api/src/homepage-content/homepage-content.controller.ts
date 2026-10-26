import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
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
import { NAVIGATION_ENV } from "../auth/navigation-features.js";
import {
  HOMEPAGE_IMAGE_LIMITS,
  HomepageContentService,
  homepageProjectionAllowed,
} from "./homepage-content.service.js";

/**
 * THE WEB SHOP'S HOME PAGE CONTENT, with the landing pages' rights: reading is
 * `products.view`, writing `products.manage`.
 */
@Controller("homepage-content")
export class HomepageContentController {
  constructor(
    private readonly content: HomepageContentService,
    /**
     * AZ ÉLES KAPCSOLÓ (acrobot 34365): a kezdőlap-szerkesztő csak ott él, ahol a környezet a teszt-
     * webshopba írhat (`MEDUSA_PROJECT_HOMEPAGE_CONTENT=true`). A commerce-kivétel csak a tesztre szól:
     * élesen minden végpont 404, a szerkesztő nem írhat az éles OS adatbázisába sem.
     */
    @Optional()
    @Inject(NAVIGATION_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  private requireHomepage(): void {
    if (!homepageProjectionAllowed(this.environment))
      throw new NotFoundException();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  get() {
    this.requireHomepage();
    return this.content.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    this.requireHomepage();
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
    this.requireHomepage();
    return this.content.setProjection(body?.enabled, user.id);
  }

  /** The products marked for the "Egyedi korallok" band, in order. */
  @Get("featured")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  featured() {
    this.requireHomepage();
    return this.content.featured();
  }

  /** Marks or unmarks one product for the band (the product page's checkbox). */
  @Put("featured/:productId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setFeatured(
    @Param("productId") productId: string,
    @Body() body: { featured?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.requireHomepage();
    return this.content.setFeatured(productId, body?.featured, user.id);
  }

  /**
   * The band's new order: exactly the marked products, the first is the large
   * card. Its own path, not `featured/order`, which `featured/:productId`
   * would read as a product id.
   */
  @Put("featured-order")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  orderFeatured(
    @Body() body: { productIds?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.requireHomepage();
    return this.content.orderFeatured(body?.productIds, user.id);
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
    this.requireHomepage();
    if (!file) throw new BadRequestException("A feltöltendő kép kötelező.");
    return this.content.uploadImage(file);
  }
}
