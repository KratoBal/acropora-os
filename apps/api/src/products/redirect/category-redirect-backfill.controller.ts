import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { CategoryRedirectBackfillDto } from "./dto/category-redirect-backfill.dto.js";
import { CategoryRedirectBackfillService } from "./category-redirect-backfill.service.js";

/**
 * A régi UNAS-kategóriacímek átirányításának terve és írása, `seo.redirects.manage`
 * joggal (a parancs `category-redirect-backfill.cli.ts` marad). Lásd a szolgáltatást.
 */
@Controller("seo/redirects")
export class CategoryRedirectBackfillController {
  constructor(private readonly backfill: CategoryRedirectBackfillService) {}

  @Post("category-backfill")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SEO_REDIRECTS_MANAGE)
  run(
    @Body() body: CategoryRedirectBackfillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.backfill.run(body, user.id);
  }
}
