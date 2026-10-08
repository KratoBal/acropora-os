import { Body, Controller, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UrlRedirectService } from "./url-redirect.service.js";

/**
 * KÉZI WEBSHOP-ÁTIRÁNYÍTÁS (SEO P0 PR 6, D2), `seo.redirects.manage` joggal.
 * Felület még nincs hozzá; a kiszolgálás (a bolt középrétege) a PR 7.
 */
@Controller("seo/redirects")
export class UrlRedirectController {
  constructor(private readonly redirects: UrlRedirectService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.SEO_REDIRECTS_MANAGE)
  create(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.redirects.create(body, user.id);
  }
}
