import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasCustomerSyncRunsQueryDto } from "./dto/unas-customer-sync-runs-query.dto.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";

@Controller("integrations/unas/customers")
export class UnasCustomerSyncController {
  constructor(
    private readonly auth: UnasAuthService,
    private readonly sync: UnasCustomerSyncService,
    private readonly repository: UnasCustomerSyncRepository,
  ) {}

  @Post("sync")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  async run() {
    const token = await this.auth.getToken();
    return this.sync.runIncremental(token);
  }

  @Get("sync-runs/:runId")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  getRun(@Param("runId") runId: string) {
    return this.repository.getRun(runId);
  }

  @Get("sync-runs")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  listRuns(@Query() query: UnasCustomerSyncRunsQueryDto) {
    return this.repository.listRuns(query.limit);
  }
}
