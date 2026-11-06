import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateRentalEquipmentDto,
  RentalEquipmentListQueryDto,
  UpdateRentalEquipmentDto,
} from "./dto/rental-equipment.dto.js";
import { RentalEquipmentService } from "./rental-equipment.service.js";

/**
 * THE RENTAL EQUIPMENT MASTER (task eszkozberles, S1). Master data under Settings, so every endpoint asks for
 * `settings.manage`, the same right as the menu entry (`rental-equipment`): split, the button would show to someone who may
 * not call it, or the reverse. The rental screen (S2) will get its own read under the rental right.
 *
 * NO DELETE: a piece is retired (`isActive: false`), because a rental and its printed contract will point at it.
 */
@Controller("rental-equipment")
export class RentalEquipmentController {
  constructor(private readonly service: RentalEquipmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  list(@Query() query: RentalEquipmentListQueryDto) {
    return this.service.list(query.includeInactive ?? false);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(@Body() input: CreateRentalEquipmentDto) {
    return this.service.create(input);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(@Param("id") id: string, @Body() input: UpdateRentalEquipmentDto) {
    return this.service.update(id, input);
  }
}
