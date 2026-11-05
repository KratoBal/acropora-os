import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { GamePublicController } from "./game-public.controller.js";
import { GameService } from "./game.service.js";

/** The Christmas giveaway (card 31445d0f): the public question, entry and confirmation. */
@Module({
  imports: [NotificationsModule],
  controllers: [GamePublicController],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
