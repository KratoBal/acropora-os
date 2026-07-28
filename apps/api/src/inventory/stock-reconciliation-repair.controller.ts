import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { StockReconciliationRepairRequestDto } from "./dto/stock-reconciliation-repair.dto.js";
import { StockReconciliationRepairService } from "./stock-reconciliation-repair.service.js";

/// Admin-only, individual-record-scoped repair endpoints (checkpoint 6).
/// Gated on INVENTORY_RECONCILIATION_REPAIR - deliberately NOT
/// INVENTORY_MANAGE, which WAREHOUSE-role users already hold for everyday
/// leltár/beszerzés/POS work (see packages/types/src/auth.ts's own doc
/// comment on the new permission for the full rationale). Only OWNER/ADMIN
/// hold it (ROLE_PERMISSIONS.MANAGER explicitly excludes it too).
///
/// The actor is ALWAYS @CurrentUser() - the request body never carries an
/// actor field, so there is no way for a caller to attribute a repair to
/// someone else (see the DTO's own doc comment). There is no bulk
/// endpoint: every route below targets exactly one StockItem by id, per
/// the checkpoint's explicit "no bulk operation" requirement.
@Controller("inventory/reconciliation")
export class StockReconciliationRepairController {
  constructor(private readonly service: StockReconciliationRepairService) {}

  @Post(":stockItemId/repair-local")
  @RequirePermissions(PERMISSIONS.INVENTORY_RECONCILIATION_REPAIR)
  repairLocal(
    @Param("stockItemId") stockItemId: string,
    @Body() body: StockReconciliationRepairRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.repairLocalFromProvenLedger({
      stockItemId,
      expectedCurrentOnHand: body.expectedCurrentOnHand,
      reason: body.reason,
      dryRun: body.dryRun,
      actorUserId: user.id,
    });
  }

  @Post(":stockItemId/republish-unas")
  @RequirePermissions(PERMISSIONS.INVENTORY_RECONCILIATION_REPAIR)
  republishUnas(
    @Param("stockItemId") stockItemId: string,
    @Body() body: StockReconciliationRepairRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.republishLocalToUnas({
      stockItemId,
      expectedCurrentOnHand: body.expectedCurrentOnHand,
      reason: body.reason,
      dryRun: body.dryRun,
      actorUserId: user.id,
    });
  }

  @Get("repairs/:repairId")
  @RequirePermissions(PERMISSIONS.INVENTORY_RECONCILIATION_REPAIR)
  getRepair(@Param("repairId") repairId: string) {
    return this.service.getRepair(repairId);
  }
}
