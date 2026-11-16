import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from "@nestjs/common";
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

  /** The stored link sources of the AI answer gate (card 9d060f5c): the same right, they decide what may leave in an answer. */
  @Get("link-sources")
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  linkSources() {
    return this.service.linkSources();
  }

  @Post("link-sources")
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  addLinkSource(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.service.addLinkSource(body, user);
  }

  @Delete("link-sources/:id")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_MANAGE)
  async removeLinkSource(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.service.removeLinkSource(id, user);
  }
}
