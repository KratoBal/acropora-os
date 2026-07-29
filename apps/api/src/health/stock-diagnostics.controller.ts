import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { Public } from "../auth/decorators/public.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { StockDiagnosticsService } from "./stock-diagnostics.service.js";

/// Health/diagnostics endpoints for the inventory/UNAS stock subsystem
/// (checkpoint 6, section 7). Deliberately separate from the pre-existing
/// generic `GET /health` (app.controller.ts, DB+Redis only) - this module
/// is inventory-specific and distinguishes liveness/readiness/detailed
/// diagnostics as three separate routes with three separate audiences:
/// an orchestrator (liveness/readiness, public, no sensitive data), and an
/// authenticated admin (detailed diagnostics + activation-readiness,
/// permission-gated). No route here ever triggers a repair, retry, or UNAS
/// call - see StockDiagnosticsService's own module doc comment.
@Controller("health/inventory")
export class StockDiagnosticsController {
  constructor(private readonly service: StockDiagnosticsService) {}

  @Get("live")
  @Public()
  live() {
    return this.service.liveness();
  }

  @Get("ready")
  @Public()
  async ready() {
    const result = await this.service.readiness();
    if (result.status === "BLOCKED") {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }

  @Get("diagnostics")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  diagnostics() {
    return this.service.diagnostics();
  }

  @Get("activation-readiness")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  activationReadiness() {
    return this.service.activationReadiness();
  }
}
