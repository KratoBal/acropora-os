import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  PartnerMergeExecuteDto,
  PartnerMergePreviewDto,
} from "./dto/partner-merge.dto.js";
import { PartnerMergeService } from "./partner-merge.service.js";

/**
 * EGY PARTNERTÖRZS, 4. LÉPÉS: AZ ÖSSZEVONÁS VÉGPONTJAI (`settings.manage`: ugyanaz a jog, mint a duplikátum-listáé; új jog nem
 * készül, a jogosultság-változtatás zárolt kategória). Az előnézet nem ír; a végrehajtás az előnézet lenyomatát kéri vissza.
 */
@Controller("admin/partner-merges")
export class PartnerMergeController {
  constructor(private readonly service: PartnerMergeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  list() {
    return this.service.list();
  }

  @Post("preview")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  preview(@Body() input: PartnerMergePreviewDto) {
    return this.service.preview(input.keptId, input.mergedId);
  }

  @Post("execute")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  execute(
    @Body() input: PartnerMergeExecuteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.execute(input, user.id);
  }

  @Post(":logId/undo")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  undo(@Param("logId") logId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.undo(logId, user.id);
  }
}
