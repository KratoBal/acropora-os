import { partnerScopeOf } from "../auth/partner-scope.util.js";
import {
  Body,
  Controller,
  Delete,
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
  list(
    @Query() query: SupplierListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, partnerScopeOf(user));
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PARTNERS_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, partnerScopeOf(user));
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
  units(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.units(id, partnerScopeOf(user));
  }

  @Post(":id/units")
  @RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
  createUnit(
    @Param("id") id: string,
    @Body() input: CreateWorksheetDepartmentDto,
  ) {
    return this.service.createUnit(id, input);
  }

  /**
   * Mi történne törléskor. A felület ezzel tudja megnevezni, MIT töröl, és
   * megmondani, MELYIK ág fut - a két eset következménye különböző, tehát a
   * megerősítő kérdés sem lehet ugyanaz.
   */
  @Get(":id/deletion-plan")
  @RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
  deletionPlan(@Param("id") id: string) {
    return this.service.deletionPlan(id);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
  remove(@Param("id") id: string) {
    return this.service.remove(id);
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
