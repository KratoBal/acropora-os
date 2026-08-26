import { Body, Controller, Post } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AiChatRequestDto } from "./dto/ai-chat.dto.js";
import { AiChatService } from "./ai-chat.service.js";

/**
 * The server-side layer between the internal test surface and the AI service.
 *
 * The browser reaches this with its own Acropora OS session; the AI access
 * token lives only in this process. That is the whole point of the endpoint:
 * the architecture forbids the browser from calling the AI API directly, and
 * a token in a page would make that forbidding meaningless.
 */
@Controller("integrations/ai-chat")
export class AiChatController {
  constructor(private readonly service: AiChatService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.AI_TEST_VIEW)
  ask(@Body() body: AiChatRequestDto) {
    return this.service.ask({
      message: body.message,
      conversationId: body.conversationId,
    });
  }
}
