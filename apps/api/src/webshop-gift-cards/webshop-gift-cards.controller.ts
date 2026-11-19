import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { WebshopGiftCardsService } from "./webshop-gift-cards.service.js";

/**
 * A WEBSHOP AJÁNDÉKKÁRTYÁI (kártya 495c0007): lista, egy kártya a naplójával, kiadás, kikapcsolás. A kártya pénzt ér,
 * ezért mind a négy a beállítások kezelőinek jár (`SETTINGS_MANAGE`), a lista is.
 */
@Controller("webshop-gift-cards")
export class WebshopGiftCardsController {
  constructor(private readonly giftCards: WebshopGiftCardsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  list() {
    return this.giftCards.list();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get(@Param("id") id: string) {
    return this.giftCards.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  issue(@Body() body: unknown) {
    return this.giftCards.issue(body);
  }

  @Post(":id/disable")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  disable(@Param("id") id: string) {
    return this.giftCards.disable(id);
  }
}
