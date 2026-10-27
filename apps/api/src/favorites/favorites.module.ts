import { Module } from "@nestjs/common";

import { FavoritesController } from "./favorites.controller.js";
import { FavoritesRepository } from "./favorites.repository.js";
import { FavoritesService } from "./favorites.service.js";

@Module({
  controllers: [FavoritesController],
  providers: [FavoritesRepository, FavoritesService],
})
export class FavoritesModule {}
