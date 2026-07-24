import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import { NavInvoiceSyncRunsQueryDto } from "./dto/nav-invoice-sync-runs-query.dto.js";
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import { NavIncomingInvoiceService } from "./nav-incoming-invoice.service.js";

@Controller("integrations/nav/invoices")
export class NavIncomingInvoiceController {
  constructor(
    private readonly service: NavIncomingInvoiceService,
    private readonly repository: NavIncomingInvoiceRepository,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  list(@Query() query: NavIncomingInvoiceListQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post("sync")
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  sync() {
    return this.service.sync();
  }

  @Get("sync-runs/:runId")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  getRun(@Param("runId") runId: string) {
    return this.repository.getRun(runId);
  }

  @Get("sync-runs")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  listRuns(@Query() query: NavInvoiceSyncRunsQueryDto) {
    return this.repository.listRuns(query.limit);
  }
}
