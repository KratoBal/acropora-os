import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AiContactRequestsService } from "./ai-contact-requests.service.js";

/**
 * The Settings side: who may read the contact requests and mark one handled. Both need `AI_SETTINGS_MANAGE` (OWNER and ADMIN, the
 * MANAGER not), like the settings themselves: a request is a customer's telephone number or address.
 */
@Controller("integrations/ai-contact-requests")
export class AiContactRequestsAdminController {
  constructor(private readonly service: AiContactRequestsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  list(@Query("limit") limit?: string) {
    return this.service.list(Number(limit));
  }

  @Post(":id/handled")
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  handled(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.handled(id, user);
  }
}
