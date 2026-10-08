import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { QuoteSendDto } from "./dto/quote-mail.dto.js";
import { QuoteMailService } from "./quote-mail.service.js";

/** #1582 P3: sending a published version; each write answers the detail. */
@Controller("quotes")
export class QuoteMailController {
  constructor(private readonly service: QuoteMailService) {}

  @Get(":id/versions/:versionId/send-draft")
  @RequirePermissions(PERMISSIONS.QUOTES_SEND)
  draft(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.draft(id, versionId, user);
  }

  @Post(":id/versions/:versionId/send")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_SEND)
  send(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Body() input: QuoteSendDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.send(id, versionId, input, user, false);
  }

  @Post(":id/versions/:versionId/resend")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_SEND)
  resend(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Body() input: QuoteSendDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.send(id, versionId, input, user, true);
  }
}
