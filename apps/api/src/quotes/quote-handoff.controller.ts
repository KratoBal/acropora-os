import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  ExecuteQuoteHandoffDto,
  QuoteHandoffPreviewDto,
} from "./dto/quote-handoff.dto.js";
import { QuoteHandoffService } from "./quote-handoff.service.js";
import { QuoteProformaService } from "./quote-proforma.js";

/** #1582 P6 and P7: starting the project, and a milestone's proforma. */
@Controller("quotes")
export class QuoteHandoffController {
  constructor(
    private readonly service: QuoteHandoffService,
    private readonly proformas: QuoteProformaService,
  ) {}

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

  /** P7: a milestone's proforma draft (once per milestone). */
  @Post(":id/milestones/:milestoneId/proforma-draft")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_HANDOFF, PERMISSIONS.BILLING_CREATE)
  proformaDraft(
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proformas.prepare(id, milestoneId, user);
  }
}
