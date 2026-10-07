import { Body, Controller, Param, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopSlugService } from "./webshop-slug.service.js";

/**
 * A WEBSHOP-SLUG KÉZI MÓDOSÍTÁSA (SEO P0 PR 5). A régi slug `SlugHistory` sorba
 * kerül; az átirányítást a PR 6 generálja belőle. Felület még nincs hozzá.
 */
@Controller("products/:id/webshop-slug")
export class WebshopSlugController {
  constructor(private readonly slugs: WebshopSlugService) {}

  @Put()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  async change(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return { slug: await this.slugs.changeSlug(id, body?.slug, user.id) };
  }
}
