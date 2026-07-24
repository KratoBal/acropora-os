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
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  list(@Query() query: SupplierListQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  create(
    @Body() input: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
}
