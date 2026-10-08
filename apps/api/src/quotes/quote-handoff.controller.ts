import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  ExecuteQuoteHandoffDto,
  QuoteHandoffPreviewDto,
} from "./dto/quote-handoff.dto.js";
import { QuoteHandoffService } from "./quote-handoff.service.js";

/** #1582 P6: starting the project from an accepted quote. */
@Controller("quotes")
export class QuoteHandoffController {
  constructor(private readonly service: QuoteHandoffService) {}

  @Post(":id/handoff/preview")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_HANDOFF)
  preview(@Param("id") id: string, @Body() input: QuoteHandoffPreviewDto) {
    return this.service.preview(id, input);
  }

  @Post(":id/handoff")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_HANDOFF)
  execute(
    @Param("id") id: string,
    @Body() input: ExecuteQuoteHandoffDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.execute(id, input, user);
  }
}
