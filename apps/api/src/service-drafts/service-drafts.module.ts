import { Module } from "@nestjs/common";
import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ServiceDraftsRepository } from "./service-drafts.repository.js";
import { ServiceDraftsService } from "./service-drafts.service.js";
import { ServiceDraftsController } from "./service-drafts.controller.js";
import { CapasuliGmailClient } from "./capasuli-gmail.client.js";
import { CapasuliGmailSyncScheduler } from "./capasuli-gmail-sync.scheduler.js";
@Module({
  imports: [ServiceJobsModule, NotificationsModule],
  controllers: [ServiceDraftsController],
  providers: [
    ServiceDraftsRepository,
    ServiceDraftsService,
    CapasuliGmailClient,
    CapasuliGmailSyncScheduler,
  ],
})
export class ServiceDraftsModule {}
