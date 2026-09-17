import { Module } from "@nestjs/common";

import { UsersController } from "./users.controller.js";
import { AccountSettingsController } from "./account-settings.controller.js";
import { AccountSettingsService } from "./account-settings.service.js";
import { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";

@Module({
  controllers: [UsersController, AccountSettingsController],
  providers: [UsersRepository, UsersService, AccountSettingsService],
  exports: [UsersRepository],
})
export class UsersModule {}
