import { Module } from "@nestjs/common";

import { AiChatController } from "./ai-chat.controller.js";
import { AiChatService } from "./ai-chat.service.js";
import { AiChatStartupValidator } from "./ai-chat-startup.validator.js";

@Module({
  controllers: [AiChatController],
  providers: [AiChatService, AiChatStartupValidator],
})
export class AiChatModule {}
