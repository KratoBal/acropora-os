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
import { BrandsService } from "./brands.service.js";
import {
  BrandAliasDto,
  BrandListQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from "./dto/brand.dto.js";

@Controller("brands")
export class BrandsController {
  constructor(private readonly service: BrandsService) {}
  @Get() @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW) list(
    @Query() query: BrandListQueryDto,
  ) {
    return this.service.list(query);
  }
  @Get(":id") @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW) detail(
    @Param("id") id: string,
  ) {
    return this.service.detail(id);
  }
  @Post() @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE) create(
    @Body() input: CreateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Patch(":id") @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE) update(
    @Param("id") id: string,
    @Body() input: UpdateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Post(":id/archive") @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE) archive(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.archive(id, user.id);
  }
  @Post(":id/restore") @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE) restore(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.restore(id, user.id);
  }
  @Post(":id/aliases")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  addAlias(
    @Param("id") id: string,
    @Body() input: BrandAliasDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addAlias(id, input, user.id);
  }
  @Patch(":id/aliases/:aliasId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  updateAlias(
    @Param("id") id: string,
    @Param("aliasId") aliasId: string,
    @Body() input: BrandAliasDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateAlias(id, aliasId, input, user.id);
  }
  @Delete(":id/aliases/:aliasId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  removeAlias(
    @Param("id") id: string,
    @Param("aliasId") aliasId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeAlias(id, aliasId, user.id);
  }
}
