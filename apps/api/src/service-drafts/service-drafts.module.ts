import { Module } from "@nestjs/common";
import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ServiceDraftsRepository } from "./service-drafts.repository.js";
import { ServiceDraftsService } from "./service-drafts.service.js";
import { ServiceDraftsController } from "./service-drafts.controller.js";
import { CapasuliGmailClient } from "./capasuli-gmail.client.js";
import { CapasuliGmailSyncScheduler } from "./capasuli-gmail-sync.scheduler.js";
import { CapasuliItemJevService } from "./capasuli-item-jev.service.js";
import { TicketMailController } from "./ticket-mail/ticket-mail.controller.js";
import { TicketMailGmailClient } from "./ticket-mail/ticket-mail-gmail.client.js";
import { TicketMailIntakeScheduler } from "./ticket-mail/ticket-mail-intake.scheduler.js";
import { TicketMailIntakeService } from "./ticket-mail/ticket-mail-intake.service.js";
import { TicketMailRepository } from "./ticket-mail/ticket-mail.repository.js";
import {
  TICKET_MAIL_AI_CLIENT,
  ticketDraftClientFromEnv,
} from "./ticket-mail/ticket-mail-ai.client.js";
@Module({
  imports: [ServiceJobsModule, NotificationsModule],
  controllers: [ServiceDraftsController, TicketMailController],
  providers: [
    ServiceDraftsRepository,
    ServiceDraftsService,
    CapasuliGmailClient,
    CapasuliGmailSyncScheduler,
    CapasuliItemJevService,
    TicketMailGmailClient,
    TicketMailRepository,
    TicketMailIntakeService,
    TicketMailIntakeScheduler,
    {
      provide: TICKET_MAIL_AI_CLIENT,
      useFactory: () => ticketDraftClientFromEnv(process.env),
    },
  ],
})
export class ServiceDraftsModule {}
