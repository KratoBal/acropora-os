import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ServiceWorkQueryDto } from "./dto/service-work.dto.js";
import { ServiceWorkService } from "./service-work.service.js";

/**
 * A FELADATAIM SZERVIZES TARTALMA (kártya 041a3dd5): a rád osztott hibajegyek
 * és munkalapok, aszerint, kin múlik a következő lépés. Csak olvas.
 */
@Controller("tasks")
export class ServiceWorkController {
  constructor(private readonly service: ServiceWorkService) {}

  @Get("service-work")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(
    @Query() query: ServiceWorkQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(user, query.view);
  }
}
