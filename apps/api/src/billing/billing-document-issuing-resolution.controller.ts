import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingIssuingResolutionService } from "./billing-issuing-resolution.service.js";
import { BillingIssuingResolveDto } from "./dto/billing-issuing-resolve.dto.js";

/**
 * A KIÁLLÍTÁS VÉSZÁLLAPOTÁBÓL KIVEZETŐ ÚT VÉGPONTJAI (kártya 38e9271d). A JOG
 * `finance.manage`, NEM `billing.issue`: azt az értékesítő is megkapja, ez a
 * lépés viszont egy már megkezdett pénzügyi bizonylat sorsáról dönt. Külön
 * controller, hogy a kiállítás útjától látványosan elváljon.
 */
@Controller("billing/documents")
export class BillingDocumentIssuingResolutionController {
  constructor(private readonly resolution: BillingIssuingResolutionService) {}

  /** Csak olvas a Számlázz.hu-n; állapotot nem ír. */
  @Post(":id/issuing-check")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  check(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resolution.check(id, user);
  }

  @Post(":id/issuing-resolve")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  resolve(
    @Param("id") id: string,
    @Body() input: BillingIssuingResolveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resolution.resolve(id, input, user);
  }
}
