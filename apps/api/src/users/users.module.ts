import { Module } from "@nestjs/common";

import { UsersController } from "./users.controller.js";
import { AccountSettingsController } from "./account-settings.controller.js";
import { AccountSettingsService } from "./account-settings.service.js";
import { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";
import { UserPermissionsRepository } from "./user-permissions.repository.js";
import { UserPermissionsService } from "./user-permissions.service.js";

@Module({
  controllers: [UsersController, AccountSettingsController],
  providers: [
    UsersRepository,
    UsersService,
    AccountSettingsService,
    UserPermissionsRepository,
    UserPermissionsService,
  ],
  exports: [UsersRepository],
})
export class UsersModule {}
