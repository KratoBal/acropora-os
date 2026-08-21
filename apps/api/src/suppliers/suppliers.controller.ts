import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateWorksheetDepartmentDto } from "../worksheets/dto/worksheet.dto.js";
import {
  CreateSupplierDto,
  SupplierListQueryDto,
  UpdateSupplierDto,
} from "./dto/supplier.dto.js";
import { SuppliersService } from "./suppliers.service.js";

@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNERS_VIEW)
  list(@Query() query: SupplierListQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PARTNERS_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
  create(
    @Body() input: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  /**
   * A partner alegységei. A `PARTNERS_*` jog dönt, nem a szerviz jog: ez a
   * partner törzsadata, azon a képernyőn, ahol a többi adata is van.
   */
  @Get(":id/units")
  @RequirePermissions(PERMISSIONS.PARTNERS_VIEW)
  units(@Param("id") id: string) {
    return this.service.units(id);
  }

  @Post(":id/units")
  @RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
  createUnit(
    @Param("id") id: string,
    @Body() input: CreateWorksheetDepartmentDto,
  ) {
    return this.service.createUnit(id, input);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
}
