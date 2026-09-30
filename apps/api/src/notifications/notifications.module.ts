import { Module } from "@nestjs/common";

import { APNS_SENDING, ApnsSender } from "./apns.sender.js";
import { FCM_SENDING, FcmSender } from "./fcm.sender.js";
import { DeviceTokenController } from "./device-token.controller.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { NotificationLogRepository } from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";
import { AquariumMeasurementMailService } from "./mail/aquarium-measurement-mail.service.js";
import { GmailMailSender } from "./mail/gmail-mail.sender.js";
import { HandoverMailRepository } from "./mail/handover-mail.repository.js";
import { HandoverMailService } from "./mail/handover-mail.service.js";
import { MaintenanceMailRepository } from "./mail/maintenance-mail.repository.js";
import { MaintenanceMailService } from "./mail/maintenance-mail.service.js";
import { InlineImageMailSender } from "./mail/inline-image.mail-sender.js";
import { MailImageController } from "./mail/mail-image.controller.js";
import { MailImageRepository } from "./mail/mail-image.repository.js";
import { MailImageService } from "./mail/mail-image.service.js";
import { MailTemplateController } from "./mail/mail-template.controller.js";
import { MAIL_SENDER } from "./mail/mail.port.js";
import { RedirectingMailSender } from "./mail/redirecting-mail.sender.js";
import { TicketMailRepository } from "./mail/ticket-mail.repository.js";
import { TicketMailService } from "./mail/ticket-mail.service.js";

@Module({
  controllers: [
    DeviceTokenController,
    MailTemplateController,
    MailImageController,
  ],
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
    /*
      A BUROK A JELZON, A GMAIL ALATTA. 2026-09-22 ota a hivok nem a Gmailt
      kapjak, hanem a terito burkot -- es ez SZERKEZETI, nem szokas: mind a
      harom kuldesi ut ezen az EGY jelzon at kapja a kuldot, tehat egyik sem
      tudja megkerulni a teritest.

      A `GmailMailSender` maga is szolgaltato marad, mert a burok konstruktora
      kéri. Kozvetlenul NEM szabad injektalni -- erre kulon allitas all a
      `mail-sender-wiring.spec.ts` fajlban.
    */
    GmailMailSender,
    /*
      A KEP-FELOLDO BUROK (2026-09-28) A KET MASIK KOZOTT ALL: az atiranyito
      ot kapja belso kuldokent, o a Gmailt. Onallo szolgaltato, mert az
      atiranyito konstruktora keri; kozvetlenul NEM szabad injektalni.
    */
    InlineImageMailSender,
    MailImageRepository,
    MailImageService,
    { provide: MAIL_SENDER, useClass: RedirectingMailSender },
    TicketMailRepository,
    TicketMailService,
    HandoverMailRepository,
    HandoverMailService,
    MaintenanceMailRepository,
    MaintenanceMailService,
    DeviceTokenRepository,
    NotificationLogRepository,
    NotificationsService,
    AquariumMeasurementMailService,
  ],
  exports: [
    /*
      A TERITO BUROK A SZAMLAZASI KIKULDESNEK (2026-09-30): a `BillingModule`
      ugyanazon a jelzon at kapja a kuldot, tehat az atiranyitast o sem
      kerulheti meg.
    */
    MAIL_SENDER,
    NotificationsService,
    TicketMailService,
    HandoverMailService,
    MaintenanceMailService,
    AquariumMeasurementMailService,
  ],
})
export class NotificationsModule {}
