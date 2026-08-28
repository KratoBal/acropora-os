import { Module } from "@nestjs/common";

import { APNS_SENDING, ApnsSender } from "./apns.sender.js";
import { DeviceTokenController } from "./device-token.controller.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { NotificationLogRepository } from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  controllers: [DeviceTokenController],
  providers: [
    // A KÜLDŐ a tokenen át érkezik, nem osztályként. Ma egy megvalósítás
    // van, és ez a sor nem ígér többet: annyit tesz, hogy a választás helye
    // meg van nevezve, ha egyszer több lesz.
    { provide: APNS_SENDING, useClass: ApnsSender },
    DeviceTokenRepository,
    NotificationLogRepository,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
