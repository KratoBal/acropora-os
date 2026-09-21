import { Module } from "@nestjs/common";

import { APNS_SENDING, ApnsSender } from "./apns.sender.js";
import { FCM_SENDING, FcmSender } from "./fcm.sender.js";
import { DeviceTokenController } from "./device-token.controller.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { NotificationLogRepository } from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";

@Module({
  controllers: [DeviceTokenController],
  providers: [
    // A KÜLDŐ a tokenen át érkezik, nem osztályként. MA MÁR KETTŐ VAN, és a
    // 2026-08-28-i komment ("ha egyszer több lesz") ezzel a sorral járt le: a
    // küldő út választása két megnevezett helyen történik, nem egy
    // konstruktor-paraméter csendes átírásával.
    { provide: APNS_SENDING, useClass: ApnsSender },
    { provide: FCM_SENDING, useClass: FcmSender },
    DeviceTokenRepository,
    NotificationLogRepository,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
