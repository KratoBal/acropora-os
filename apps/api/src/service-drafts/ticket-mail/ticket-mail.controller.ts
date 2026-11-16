import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { TicketMailIntakeService } from "./ticket-mail-intake.service.js";

/** The ticket@ intake's status for the internal admins (the switch, the limits, the last run): read only, nothing here starts a run. */
@Controller("service/drafts/ticket-mail")
@RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
export class TicketMailController {
  constructor(private readonly intake: TicketMailIntakeService) {}

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.intake.status(user);
  }
}
