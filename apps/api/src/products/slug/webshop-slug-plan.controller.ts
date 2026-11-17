import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { WebshopSlugPlanService } from "./webshop-slug-plan.service.js";

/** The read-only slug plan; see the service. No other handler may live here: the spec pins the handler list. */
@Controller("seo/webshop-slug-plan")
export class WebshopSlugPlanController {
  constructor(private readonly slugPlan: WebshopSlugPlanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  plan() {
    return this.slugPlan.plan();
  }
}
