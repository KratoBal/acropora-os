import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AiChatRatingDto, AiChatRequestDto } from "./dto/ai-chat.dto.js";
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

  /**
   * Records what somebody thought of one answer.
   *
   * The author is taken from the session, never from the request. That is the
   * one thing this hop can do that the browser cannot be trusted to do for
   * itself, and it is the same rule the boundary document states about the
   * customer identifier: a claim forwarded from a caller is not proof.
   *
   * Judging is gated on the same permission as seeing, deliberately. Anyone
   * who can read the answers is who the measurement wants an opinion from,
   * and a second permission would be a lock on a door standing open.
   */
  @Post("messages/:messageId/rating")
  @RequirePermissions(PERMISSIONS.AI_TEST_VIEW)
  rate(
    @Param("messageId", ParseUUIDPipe) messageId: string,
    @Body() body: AiChatRatingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rate({
      messageId,
      rating: body.rating,
      ratedBy: user.id,
    });
  }
}
