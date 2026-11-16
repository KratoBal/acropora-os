import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ManualListService } from "./customer-candidates-manual.service.js";

/**
 * THE MANUAL PRODUCT LIST, admin side (V3.4 S2c-3). Both routes follow `products.knowledge.approve` (OWNER and ADMIN only, the MANAGER not):
 * what this list holds becomes a product recommendation a customer reads, the same kind of decision the product knowledge approval is.
 * No new permission: the model of who may approve product text is not widened.
 */
@Controller("customer-candidates/manual-list")
export class ManualListController {
  constructor(private readonly service: ManualListService) {}

  /** Writes nothing. Returns the report and the fingerprint the apply must carry. */
  @Post("dry-run")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  dryRun(@Body() body: unknown) {
    return this.service.dryRun(body);
  }

  @Post("apply")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  apply(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.service.apply(body, user);
  }
}
