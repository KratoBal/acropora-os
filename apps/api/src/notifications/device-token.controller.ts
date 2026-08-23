import { Body, Controller, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { DeviceTokenRepository } from "./device-token.repository.js";
import { RegisterDeviceTokenDto } from "./dto/device-token.dto.js";

/**
 * Where a phone says "this is me, notify me here".
 *
 * No permission decorator: the global auth guard already requires a signed-in
 * colleague, and registering a device is not somebody else's business to
 * grant. The owner is taken from the session and never from the body - a
 * client that could name the user could subscribe a colleague's phone to its
 * own notifications.
 */
@Controller("notifications/device-tokens")
export class DeviceTokenController {
  constructor(private readonly repository: DeviceTokenRepository) {}

  @Post()
  async register(
    @Body() input: RegisterDeviceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.repository.register({
      userId: user.id,
      token: input.token.toLowerCase(),
      bundleId: input.bundleId.trim(),
      platform: input.platform ?? "IOS",
    });
    return { ok: true };
  }
}
