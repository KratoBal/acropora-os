import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import type { MedusaRedirectPlanView } from "./medusa-redirect-plan.js";
import { MedusaRedirectPlanService } from "./medusa-redirect-plan.service.js";

/**
 * A VETÍTÉS TERVE (task t-20261118-vetites-terv-get): csak olvas, ugyanaz a jog, mint az ár-ellenőrzésé és a vetítés állapotáé. Egy elérhetetlen
 * webshop vagy egy hiányzó hitelesítő adat nem a hívó hibája: 503, a kód a törzsben.
 */
@Controller("health/medusa-redirect-plan")
export class MedusaRedirectPlanController {
  constructor(private readonly service: MedusaRedirectPlanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async plan(): Promise<MedusaRedirectPlanView> {
    try {
      return await this.service.plan();
    } catch (error) {
      if (
        error instanceof MedusaConnectionError ||
        error instanceof MedusaConfigurationError
      )
        throw new HttpException(
          error instanceof MedusaConnectionError
            ? error.code
            : "MEDUSA_NOT_CONFIGURED",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      throw error;
    }
  }
}
