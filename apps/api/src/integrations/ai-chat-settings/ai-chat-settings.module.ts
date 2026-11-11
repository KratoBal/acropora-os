import { Module } from "@nestjs/common";

import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AiChatSettingsAdminController } from "./ai-chat-settings.admin.controller.js";
import { AiChatSettingsGuard } from "./ai-chat-settings.guard.js";
import { AiChatSettingsReaderController } from "./ai-chat-settings.reader.controller.js";
import { AiChatSettingsRepository } from "./ai-chat-settings.repository.js";
import { AiChatSettingsService } from "./ai-chat-settings.service.js";

@Module({
  controllers: [AiChatSettingsAdminController, AiChatSettingsReaderController],
  providers: [
    AiChatSettingsGuard,
    AiChatSettingsRepository,
    AiChatSettingsService,
    ServiceTokenRepository,
  ],
})
export class AiChatSettingsModule {}
