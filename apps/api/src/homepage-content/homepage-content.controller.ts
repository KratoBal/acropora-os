import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { HomepageContentService } from "./homepage-content.service.js";

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
}
