import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  WebshopShortageAgreementDto,
  WebshopShortageOpenDto,
  WebshopShortageResolveDto,
} from "./dto/webshop-order-shortage.dto.js";
import { WebshopOrderShortagesService } from "./webshop-order-shortages.service.js";

/**
 * A KÉSZLETHIÁNY-REKORD ÚTVONALAI (kártya ac167fc2). Csak rögzít és olvas: a rendelést a tétel-művelet és a szétbontás módosítja.
 * A `:id/shortages` két szegmenses, tehát nem ütközik a `:id` adatlappal.
 */
@Controller("webshop-orders")
export class WebshopOrderShortagesController {
  constructor(private readonly shortages: WebshopOrderShortagesService) {}

  @Get(":id/shortages")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  list(@Param("id") id: string) {
    return this.shortages.list(id);
  }

  @Post(":id/shortages")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  open(
    @Param("id") id: string,
    @Body() body: WebshopShortageOpenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shortages.open(id, body, user);
  }

  @Put(":id/shortages/:shortageId/agreement")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  agree(
    @Param("id") id: string,
    @Param("shortageId") shortageId: string,
    @Body() body: WebshopShortageAgreementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shortages.agree(id, shortageId, body, user);
  }

  @Post(":id/shortages/:shortageId/resolve")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  resolve(
    @Param("id") id: string,
    @Param("shortageId") shortageId: string,
    @Body() body: WebshopShortageResolveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shortages.resolve(id, shortageId, body, user);
  }
}
