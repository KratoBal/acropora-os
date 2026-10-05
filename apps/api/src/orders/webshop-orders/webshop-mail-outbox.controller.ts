import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  DefaultValuePipe,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopMailOutboxService } from "./webshop-mail-outbox.service.js";

/**
 * The stuck webshop mails, for the Levélsablonok page: whoever edits the
 * templates sees what a broken one held back, and puts it back once fixed.
 */
@Controller("webshop-mail-outbox")
export class WebshopMailOutboxController {
  constructor(private readonly outbox: WebshopMailOutboxService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  stuck(
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.outbox.stuck(Math.max(0, offset));
  }

  @Post(":id/retry")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  retry(@Param("id") id: string) {
    return this.outbox.retry(id);
  }
}
