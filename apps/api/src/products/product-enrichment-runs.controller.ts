import { Controller, Get, Inject, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  ENRICHMENT_RUNS_READER,
  type EnrichmentRunsReader,
  runListLimit,
} from "./enrichment/enrichment-runs.read.js";

/**
 * `GET /products/enrichment/runs?limit=`: the newest JEV runs with every product's fetches (outcome, reason, HTTP code)
 * and field summary, read only, `products.view` (`enrichment-runs.read.ts`). The way to see what a run did when its
 * output cannot be read where it ran (the test API's Coolify task, acrobot 50407).
 */
@Controller("products")
export class ProductEnrichmentRunsController {
  constructor(
    @Inject(ENRICHMENT_RUNS_READER)
    private readonly runs: EnrichmentRunsReader,
  ) {}

  @Get("enrichment/runs")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  list(@Query("limit") limit?: string) {
    return this.runs.recentRuns(runListLimit(limit));
  }
}
