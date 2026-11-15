import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { RedirectUndoDto } from "./dto/redirect-undo.dto.js";
import { RedirectUndoService } from "./redirect-undo.service.js";

/** Egy kategória- vagy termék-átirányítás írásának visszavonása, `seo.redirects.manage` joggal. Lásd a szolgáltatást. */
@Controller("seo/redirects")
export class RedirectUndoController {
  constructor(private readonly undo: RedirectUndoService) {}

  @Post("undo")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SEO_REDIRECTS_MANAGE)
  run(@Body() body: RedirectUndoDto, @CurrentUser() user: AuthenticatedUser) {
    return this.undo.run(body, user.id);
  }
}
