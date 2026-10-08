import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CancelQuoteDto,
  PostponeQuoteDto,
  RecordQuoteAcceptanceDto,
  RejectQuoteDto,
  RevokeQuoteAcceptanceDto,
} from "./dto/quote-acceptance.dto.js";
import { QuoteAcceptanceService } from "./quote-acceptance.service.js";

/** #1582 P4a: the quote's outcome. Each answers the updated detail. */
@Controller("quotes")
export class QuoteAcceptanceController {
  constructor(private readonly service: QuoteAcceptanceService) {}

  @Post(":id/acceptances")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_ACCEPTANCE_RECORD)
  accept(
    @Param("id") id: string,
    @Body() input: RecordQuoteAcceptanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.accept(id, input, user);
  }

  @Post(":id/acceptances/:acceptanceId/revoke")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_ACCEPTANCE_RECORD)
  revoke(
    @Param("id") id: string,
    @Param("acceptanceId") acceptanceId: string,
    @Body() input: RevokeQuoteAcceptanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revoke(id, acceptanceId, input, user);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  reject(
    @Param("id") id: string,
    @Body() input: RejectQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, input, user);
  }

  @Post(":id/postpone")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  postpone(
    @Param("id") id: string,
    @Body() input: PostponeQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.postpone(id, input, user);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  cancel(
    @Param("id") id: string,
    @Body() input: CancelQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancel(id, input, user);
  }
}
