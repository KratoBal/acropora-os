import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AiChatSettingsService } from "./ai-chat-settings.service.js";

/**
 * The Settings page's side: who may read and change the AI chat settings. Both need `AI_SETTINGS_MANAGE` (OWNER and ADMIN, the
 * MANAGER not): the settings decide what happens to a customer's personal data, and the recipient is an address.
 */
@Controller("integrations/ai-chat-settings")
export class AiChatSettingsAdminController {
  constructor(private readonly service: AiChatSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  settings() {
    return this.service.settings();
  }

  /** The body is checked by the shared rule in the service (one Hungarian sentence per refusal), not by a field-by-field DTO. */
  @Put()
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.service.save(body, user);
  }
}
