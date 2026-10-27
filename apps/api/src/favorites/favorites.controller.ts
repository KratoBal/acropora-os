import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { FavoriteHrefDto } from "./dto/favorite.dto.js";
import { FavoritesService } from "./favorites.service.js";

/**
 * A SAJÁT KEDVENCEK. Nincs `@RequirePermissions`, szándékosan: minden belépett
 * felhasználó a saját listáját kezeli, és a lista a menü útvonalait tartalmazza,
 * nem adatot. A fiók-beállítások (`account`) ugyanígy állnak.
 */
@Controller("favorites")
export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }

  @Post()
  add(@Body() input: FavoriteHrefDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.add(user.id, input.href);
  }

  /** A kivétel útvonala lekérdezésben megy, mert a törzs a DELETE-nél nem megbízható. */
  @Delete()
  remove(@Query("href") href: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(user.id, href);
  }
}
