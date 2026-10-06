import { Controller, Get, Header, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MessagesService } from "../messages.service.js";
import { AssistantHandoffRepliesQueryDto } from "./sutyerak-handoff.dto.js";

/**
 * A WIDGET OLDALA (5830ee10): acrobot válaszai a widget egy beszélgetésére.
 * A dolgozó SAJÁT munkamenetével, csak olvas, és csak a saját kettes
 * beszélgetéséből ad (lásd `MessagesService.widgetReplies`). A visszaírás
 * (`assistant/handoff-reply`) külön végpont, a saját szolgáltatás-tokenjével.
 */
@Controller("assistant/handoff-replies")
export class AssistantHandoffRepliesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  @Header("Cache-Control", "private, no-store")
  replies(
    @Query() query: AssistantHandoffRepliesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.widgetReplies(user, query.threadId);
  }
}
