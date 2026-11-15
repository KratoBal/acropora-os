import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ProductRedirectBackfillDto } from "./dto/product-redirect-backfill.dto.js";
import { ProductRedirectBackfillService } from "./product-redirect-backfill.service.js";

/**
 * A régi UNAS-termékcímek átirányításának terve és írása, `seo.redirects.manage` joggal (a parancs `redirect-backfill.cli.ts` marad). Lásd a
 * szolgáltatást.
 */
@Controller("seo/redirects")
export class ProductRedirectBackfillController {
  constructor(private readonly backfill: ProductRedirectBackfillService) {}

  @Post("product-backfill")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SEO_REDIRECTS_MANAGE)
  run(
    @Body() body: ProductRedirectBackfillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.backfill.run(body, user.id);
  }
}
