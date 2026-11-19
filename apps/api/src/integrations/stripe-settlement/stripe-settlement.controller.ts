import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ApproveStripeLineDto } from "./dto/approve-stripe-line.dto.js";
import { StripePayoutListQueryDto } from "./dto/stripe-payout-list-query.dto.js";
import { StripeSettlementService } from "./stripe-settlement.service.js";

/**
 * STRIPE ELSZÁMOLÁS (A9): Stripe's payouts, their transactions tied to the webshop order and its invoice. The same shape and
 * rights as the SimplePay and GLS settlements: reading is finance.view, changing is finance.manage.
 */
@Controller("integrations/stripe")
export class StripeSettlementController {
  constructor(private readonly settlements: StripeSettlementService) {}

  /** Whether the pull runs, and why not; and its last run. */
  @Get("sync")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  syncStatus() {
    return this.settlements.status();
  }

  /** One pull now, whatever the switch says. */
  @Post("sync")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  syncNow() {
    return this.settlements.sync("MANUAL");
  }

  @Get("payouts")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listPayouts(@Query() query: StripePayoutListQueryDto) {
    return this.settlements.listPayouts(query);
  }

  @Get("payouts/:id")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  payoutDetail(@Param("id") id: string) {
    return this.settlements.payoutDetail(id);
  }

  @Post("payouts/:id/lines/:lineId/approve")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  approveLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() input: ApproveStripeLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.approveLine(id, lineId, input, user.id);
  }
}
