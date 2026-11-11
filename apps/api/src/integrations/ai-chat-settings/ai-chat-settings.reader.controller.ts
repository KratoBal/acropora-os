import { Controller, Get, UseGuards } from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { AiChatSettingsGuard } from "./ai-chat-settings.guard.js";
import { AiChatSettingsService } from "./ai-chat-settings.service.js";

/**
 * The AI service's side: read-only, behind its own service-token record. It returns the three values the service acts on and
 * the stored link sources' host, category and brand (card 9d060f5c), nothing else (no recipient, no retention of contact
 * requests, no note or author of a link source).
 */
@Controller("integrations/ai-chat-settings/service")
@Public()
@UseGuards(AiChatSettingsGuard)
export class AiChatSettingsReaderController {
  constructor(private readonly service: AiChatSettingsService) {}

  @Get()
  view() {
    return this.service.serviceView();
  }
}
