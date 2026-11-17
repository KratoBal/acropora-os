import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  parseMeasureQuery,
  TicketMailAuthMeasureService,
} from "./ticket-mail-auth-measure.service.js";
import { TicketMailIntakeService } from "./ticket-mail-intake.service.js";

/** The ticket@ intake's status for the internal admins (the switch, the limits, the last run): read only, nothing here starts a run. */
@Controller("service/drafts/ticket-mail")
@RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
export class TicketMailController {
  constructor(
    private readonly intake: TicketMailIntakeService,
    private readonly authMeasure: TicketMailAuthMeasureService,
  ) {}

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.intake.status(user);
  }

  /**
   * The Authentication-Results of the newest mails of the mailbox, masked: the real form of the header decides whether the intake may be switched
   * on. Read only (the intake's GET-only client, no attachment downloaded, nothing written); the output carries no subject, text, address, IP,
   * Gmail id or query.
   */
  @Get("auth-measure")
  authMeasureRead(
    @Query("limit") limit?: unknown,
    @Query("query") query?: unknown,
  ) {
    const parsed = parseMeasureQuery({ limit, query });
    return this.authMeasure.measure(parsed.limit, parsed.query);
  }
}
