import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasProductSyncQueryDto } from "./dto/unas-product-sync-query.dto.js";
import { UnasSyncRunsQueryDto } from "./dto/unas-sync-runs-query.dto.js";
import { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";

@Controller("integrations/unas/products")
export class UnasProductSyncController {
  constructor(
    private readonly auth: UnasAuthService,
    private readonly sync: UnasProductSyncService,
    private readonly repository: UnasProductSyncRepository,
  ) {}

  /**
   * A `full=true` a TELJES osszevetest keri: a szinkron figyelmen kivul hagyja a
   * kurzort, es minden terméket vegignez. Alapertelmezesben HIANYZIK, tehat a
   * mai viselkedes valtozatlan -- teljes futas csak kifejezett keresre indul.
   */
  @Post("sync")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  async run(@Query() query: UnasProductSyncQueryDto) {
    const token = await this.auth.getToken();
    return this.sync.runIncremental(token, undefined, undefined, query.full);
  }

  @Get("sync-runs/:runId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  getRun(@Param("runId") runId: string) {
    return this.repository.getRun(runId);
  }

  @Get("sync-runs")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  listRuns(@Query() query: UnasSyncRunsQueryDto) {
    return this.repository.listRuns(query.limit);
  }
}
