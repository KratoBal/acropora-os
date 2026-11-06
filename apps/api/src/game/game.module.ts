import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { GameAdminController } from "./game-admin.controller.js";
import { GameAdminService } from "./game-admin.service.js";
import { GamePublicController } from "./game-public.controller.js";
import { GameService } from "./game.service.js";

/** The Christmas giveaway (card 31445d0f): the public question, entry and confirmation; the admin and the draws. */
@Module({
  imports: [NotificationsModule],
  controllers: [GamePublicController, GameAdminController],
  providers: [GameService, GameAdminService],
  exports: [GameService],
})
export class GameModule {}
