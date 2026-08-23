import { Module } from "@nestjs/common";

import { ApnsSender } from "./apns.sender.js";
import { DeviceTokenController } from "./device-token.controller.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { NotificationLogRepository } from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  controllers: [DeviceTokenController],
  providers: [
    ApnsSender,
    DeviceTokenRepository,
    NotificationLogRepository,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
