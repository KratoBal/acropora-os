import { Module } from "@nestjs/common";

import { APNS_SENDING, ApnsSender } from "./apns.sender.js";
import { FCM_SENDING, FcmSender } from "./fcm.sender.js";
import { DeviceTokenController } from "./device-token.controller.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { NotificationLogRepository } from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";
import { GmailMailSender } from "./mail/gmail-mail.sender.js";
import { HandoverMailRepository } from "./mail/handover-mail.repository.js";
import { HandoverMailService } from "./mail/handover-mail.service.js";
import { MailTemplateController } from "./mail/mail-template.controller.js";
import { MAIL_SENDER } from "./mail/mail.port.js";
import { TicketMailRepository } from "./mail/ticket-mail.repository.js";
import { TicketMailService } from "./mail/ticket-mail.service.js";

@Module({
  controllers: [DeviceTokenController, MailTemplateController],
  providers: [
    // A KÜLDŐ a tokenen át érkezik, nem osztályként. MA MÁR KETTŐ VAN, és a
    // 2026-08-28-i komment ("ha egyszer több lesz") ezzel a sorral járt le: a
    // küldő út választása két megnevezett helyen történik, nem egy
    // konstruktor-paraméter csendes átírásával.
    { provide: APNS_SENDING, useClass: ApnsSender },
    { provide: FCM_SENDING, useClass: FcmSender },
    /*
      A LEVELKULDO IS TOKENEN AT ERKEZIK, ugyanabbol az okbol, mint a ket
      push-kuldo: a hivo a `MailSender` interfeszt latja, es a Gmail
      lecserelese EGY megnevezett sor atirasa lesz, nem egy konstruktor csendes
      valtozasa.
    */
    { provide: MAIL_SENDER, useClass: GmailMailSender },
    TicketMailRepository,
    TicketMailService,
    HandoverMailRepository,
    HandoverMailService,
    DeviceTokenRepository,
    NotificationLogRepository,
    NotificationsService,
  ],
  exports: [NotificationsService, TicketMailService, HandoverMailService],
})
export class NotificationsModule {}
