import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateOperationsTaskTemplateDto,
  OperationsTaskTemplateListQueryDto,
  UpdateOperationsTaskTemplateDto,
} from "./dto/operations-task-template.dto.js";
import { OperationsLogService } from "./operations-log.service.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ SABLONJAINAK VÉGPONTJAI (task os-uzemeltetesi-naplo, S1).
 *
 * KÉT JOGKÖR, mint az eszköz-kategóriánál: az OLVASÁS (`operations-log.view`) a rögzítőké (a szerelő ezekből a sablonokból
 * rögzít, S2), az ÍRÁS (`operations-log.templates.manage`) a sablonok gondozása. Ha az írás is a nézet joga lenne, minden
 * szerelő átírhatná a sablont, amelyből a havi kimutatás készül.
 *
 * A MÓDOSÍTÁS `PUT`: a kérés a sablon TELJES alakját (a teljes mezőkészlettel) adja, nem darabját.
 */
@Controller("operations-log/templates")
export class OperationsLogController {
  constructor(private readonly service: OperationsLogService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  list(@Query() query: OperationsTaskTemplateListQueryDto) {
    return this.service.list(query.includeInactive ?? false);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE)
  create(
    @Body() input: CreateOperationsTaskTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateOperationsTaskTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE)
  retire(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.retire(id, user.id);
  }
}
