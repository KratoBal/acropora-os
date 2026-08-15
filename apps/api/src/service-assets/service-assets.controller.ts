import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import { ServiceAssetsService } from "./service-assets.service.js";

@Controller("service/assets")
export class ServiceAssetsController {
  constructor(private readonly service: ServiceAssetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@Query() query: AssetListQueryDto) {
    return this.service.list(query);
  }

  @Get("scan/:qrToken")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  scan(@Param("qrToken") qrToken: string) {
    return this.service.scan(qrToken);
  }

  @Get(":id/qr")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  qrCode(@Param("id") id: string) {
    return this.service.qrCode(id);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Post(":id/qr/rotate")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  rotateQr(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rotateQr(id, user.id);
  }
}
