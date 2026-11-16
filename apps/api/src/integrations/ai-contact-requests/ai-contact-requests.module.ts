import { Module } from "@nestjs/common";

import { NotificationsModule } from "../../notifications/notifications.module.js";
import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AiChatSettingsModule } from "../ai-chat-settings/ai-chat-settings.module.js";
import { AiContactRequestsAdminController } from "./ai-contact-requests.admin.controller.js";
import { AiContactRequestsGuard } from "./ai-contact-requests.guard.js";
import { AiContactRequestsRetention } from "./ai-contact-requests.retention.js";
import { AiContactRequestsRepository } from "./ai-contact-requests.repository.js";
import { AiContactRequestsService } from "./ai-contact-requests.service.js";
import { AiContactRequestsWriterController } from "./ai-contact-requests.writer.controller.js";

@Module({
  imports: [AiChatSettingsModule, NotificationsModule],
  controllers: [
    AiContactRequestsWriterController,
    AiContactRequestsAdminController,
  ],
  providers: [
    AiContactRequestsGuard,
    AiContactRequestsRepository,
    AiContactRequestsRetention,
    AiContactRequestsService,
    ServiceTokenRepository,
  ],
})
export class AiContactRequestsModule {}
