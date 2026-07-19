import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";
import {
  BrandImportRowsQueryDto,
  BulkCreateImportBrandsDto,
  CreateBrandFromImportDto,
  MapImportAliasDto,
  MapImportExternalDto,
} from "./dto/brand-import-assistant.dto.js";

@Controller("brands/import-assistant")
export class BrandImportAssistantController {
  constructor(private readonly service: BrandImportAssistantService) {}

  @Get("batches")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  batches() {
    return this.service.batches();
  }

  @Get("batches/:batchId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  summary(@Param("batchId") batchId: string) {
    return this.service.summary(batchId);
  }

  @Get("batches/:batchId/rows")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  rows(
    @Param("batchId") batchId: string,
    @Query() query: BrandImportRowsQueryDto,
  ) {
    return this.service.rows(batchId, query);
  }

  @Post("batches/:batchId/rows/:rowId/create-brand")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  createBrand(
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @Body() input: CreateBrandFromImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createBrand(batchId, rowId, input, user.id);
  }

  @Post("batches/:batchId/rows/:rowId/map-alias")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  mapAlias(
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @Body() input: MapImportAliasDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mapAlias(batchId, rowId, input, user.id);
  }

  @Post("batches/:batchId/rows/:rowId/map-external")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  mapExternal(
    @Param("batchId") batchId: string,
    @Param("rowId") rowId: string,
    @Body() input: MapImportExternalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.mapExternal(batchId, rowId, input, user.id);
  }

  @Post("batches/:batchId/bulk-create")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  bulkCreate(
    @Param("batchId") batchId: string,
    @Body() input: BulkCreateImportBrandsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.bulkCreate(batchId, input, user.id);
  }
}
