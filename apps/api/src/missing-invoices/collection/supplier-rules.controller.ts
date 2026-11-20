import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  PERMISSIONS,
  type AcceptWithRuleResult,
  type AuthenticatedUser,
  type AutoAcceptUndoResult,
  type AutoAcceptedView,
  type SupplierRulePreview,
  type SupplierRuleView,
} from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AcceptWithRuleDto } from "./supplier-rules.dto.js";
import { SupplierRulesService } from "./supplier-rules.service.js";

/**
 * AZ ISMERT SZÁLLÍTÓ SZABÁLYAI A JAVASOLT SZÁMLÁK LAPJÁN (acrobot 57881, 57884). A jogok a javaslatokéi: az olvasás
 * `finance.view`, a döntés (szabály létrehozása, kikapcsolása, visszavonás) `finance.manage`.
 */
@Controller("missing-invoices")
export class SupplierRulesController {
  constructor(private readonly rules: SupplierRulesService) {}

  @Get("suggestions/:id/rule-preview")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  preview(
    @Param("id") id: string,
    @Query("vendorName") vendorName?: string,
  ): Promise<SupplierRulePreview> {
    return this.rules.preview(id, vendorName?.slice(0, 120));
  }

  @Post("suggestions/:id/accept-with-rule")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  acceptWithRule(
    @Param("id") id: string,
    @Body() input: AcceptWithRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AcceptWithRuleResult> {
    return this.rules.acceptWithRule(id, input, user);
  }

  @Get("supplier-rules")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  list(): Promise<SupplierRuleView[]> {
    return this.rules.list();
  }

  @Post("supplier-rules/:ruleId/disable")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  disable(
    @Param("ruleId") ruleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rules.disable(ruleId, user);
  }

  @Get("auto-accepted")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  autoAccepted(): Promise<AutoAcceptedView[]> {
    return this.rules.autoAccepted();
  }

  @Post("auto-accepted/:id/undo")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  undo(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AutoAcceptUndoResult> {
    return this.rules.undo(id, user);
  }
}
