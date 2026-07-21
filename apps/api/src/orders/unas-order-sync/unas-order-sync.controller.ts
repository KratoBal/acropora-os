import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasOrderListQueryDto } from "./dto/unas-order-list-query.dto.js";
import { UnasOrderSyncRunsQueryDto } from "./dto/unas-order-sync-runs-query.dto.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";

@Controller("integrations/unas/orders")
export class UnasOrderSyncController {
  constructor(
    private readonly auth: UnasAuthService,
    private readonly sync: UnasOrderSyncService,
    private readonly repository: UnasOrderSyncRepository,
  ) {}

  @Post("sync")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  async run() {
    const token = await this.auth.getToken();
    return this.sync.runIncremental(token);
  }

  @Get("sync-runs/:runId")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  getRun(@Param("runId") runId: string) {
    return this.repository.getRun(runId);
  }

  @Get("sync-runs")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  listRuns(@Query() query: UnasOrderSyncRunsQueryDto) {
    return this.repository.listRuns(query.limit);
  }

  @Get("stock/reconciliation")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  checkStockReconciliation() {
    return this.sync.checkStockReconciliation();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  list(@Query() query: UnasOrderListQueryDto) {
    return this.repository.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  async getOne(@Param("id") id: string) {
    const order = await this.repository.findById(id);
    if (!order) throw new NotFoundException("A rendelés nem található.");
    return order;
  }
}
