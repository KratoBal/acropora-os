import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { SeoLandingService } from "./seo-landing.service.js";

/**
 * THE SEO LANDING PAGES (SEO P1-14), with the brand pages' rights: reading is
 * `products.view`, writing `products.manage`. No delete in v1: a page is taken
 * down by unpublishing it.
 */
@Controller("seo/landing-pages")
export class SeoLandingController {
  constructor(private readonly landings: SeoLandingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  list() {
    return this.landings.list();
  }

  // before ":id", or GET /seo/landing-pages/options resolves to it
  @Get("options")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  options() {
    return this.landings.options();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  detail(@Param("id") id: string) {
    return this.landings.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  create(@Body() body: Record<string, unknown>) {
    return this.landings.create(body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  update(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.landings.update(id, body, user.id);
  }
}
