import { Module } from "@nestjs/common";

import { AiChatController } from "./ai-chat.controller.js";
import { AiChatService } from "./ai-chat.service.js";

@Module({
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
