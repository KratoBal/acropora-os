import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  PartnerConversationQueryDto,
  PartnerMessageDto,
} from "./dto/messages.dto.js";
import { MessagesService } from "./messages.service.js";

/**
 * A HIBAJEGY PARTNERES BESZÉLGETÉSE A PARTNER PORTÁLON (kártya 084e2c24).
 *
 * A partner a hibajegy oldalán, ezen a két útvonalon ír és olvas; az Üzenetek
 * modul (`/messages`) számára zárt marad. A hozzáférés minden hívásnál a
 * hibajegy láthatóságából jön (ugyanaz, mint a portál hibajegy-listájáé), és
 * csak a hibajegy `PARTNER` közönségű beszélgetésére szól.
 */
@Controller("service/jobs")
export class PartnerConversationController {
  constructor(private readonly messages: MessagesService) {}

  @Get(":id/partner-conversation")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  conversation(
    @Param("id") id: string,
    @Query() query: PartnerConversationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.partnerConversation(user, id, query);
  }

  @Post(":id/partner-conversation/messages")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  send(
    @Param("id") id: string,
    @Body() body: PartnerMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.sendAsPartner(user, id, body);
  }
}
