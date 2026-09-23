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
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { AssetFunctionsService } from "./asset-functions.service.js";
import {
  AssetFunctionListQueryDto,
  CreateAssetFunctionDto,
  UpdateAssetFunctionDto,
} from "./dto/asset-function.dto.js";

/**
 * A FUNKCIO-TORZSADAT VEGPONTJAI -- SZO SZERINT AZ
 * `AssetCategoriesController` BONTASA: OLVASAS `SERVICE_VIEW`, IRAS
 * `SETTINGS_MANAGE`. Lasd ott a teljes indoklast.
 */
@Controller("asset-functions")
export class AssetFunctionsController {
  constructor(private readonly service: AssetFunctionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@Query() query: AssetFunctionListQueryDto) {
    return this.service.list(query.includeInactive ?? false);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(@Body() input: CreateAssetFunctionDto) {
    return this.service.create(input);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(@Param("id") id: string, @Body() input: UpdateAssetFunctionDto) {
    return this.service.update(id, input);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  retire(@Param("id") id: string) {
    return this.service.retire(id);
  }
}
