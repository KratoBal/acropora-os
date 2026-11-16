import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { ContentAgentGuard } from "../content-agent.guard.js";
import {
  parseProductDataRequest,
  type RawProductDataParams,
} from "./product-data.query.js";
import { ProductDataService } from "./product-data.service.js";

/**
 * THE CONTENT AGENT'S READ-ONLY WINDOW ONTO PRICE, STOCK AND ARRIVALS (task t54-friss-termekadat).
 *
 * THE SAME DOOR AS THE CONTENT QUEUE, NOT A NEW RIGHT. `ContentAgentGuard` is the content agent's own entry: its token
 * must be on the `ACROPORA_CONTENT_AGENT_TOKEN_IDS` list and its account must be active with `content.manage`. This
 * endpoint adds no permission and no environment variable: whoever may write a draft may read the data the draft is
 * about, and nobody else. (`@Public()` only steps the global `AuthGuard` aside, as in `ContentAgentController`; the
 * guard does the checking, the permission included.)
 *
 * A SEPARATE PREFIX, not `content/...`: `ContentController` has `@Get(":id")` and `ContentAgentController` too, and a
 * static route registered after a parameter route would be swallowed by it.
 *
 * ONLY `GET`. There is no write method in this controller, the service or the repository, in any direction (spec 3, 5).
 */
@Public()
@UseGuards(ContentAgentGuard)
@Controller("agent-product-data")
export class ProductDataController {
  constructor(private readonly service: ProductDataService) {}

  /**
   * `?ids=<product id or SKU>,...` and/or `?category=<category id>,...` and/or `?onSale=true`, plus `limit`/`offset`.
   * At least one filter is required; a bad value is a 400, never a default.
   */
  @Get()
  read(@Query() params: RawProductDataParams) {
    return this.service.read(parseProductDataRequest(params));
  }
}
