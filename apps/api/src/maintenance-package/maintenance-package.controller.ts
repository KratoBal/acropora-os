import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";

import { MaintenanceMailService } from "../notifications/mail/maintenance-mail.service.js";
import { SendMaintenancePackageMailDto } from "./dto.js";
import { MaintenancePackageService } from "./maintenance-package.service.js";

/**
 * A KARBANTARTÁSI LAP DOKUMENTUMCSOMAGJA -- LETÖLTÉS ÉS KIKÜLDÉS.
 *
 * Ugyanaz a jog, mint a szerződésen, a megrendelőlapon és a teljesítési
 * igazoláson: `PARTNERS_MANAGE`. Ez a jog a `SERVICE` szerepkörnél NEM áll
 * (lásd `packages/types/src/auth.ts`), tehát -- a hibajegyes
 * `HandoverMailController`-rel ellentétben -- itt nincs szükség külön
 * `partnerScopeOf` ellenőrzésre: a technikus szerkezetileg nem éri el ezt a
 * vezérlőt.
 */
@Controller("partners/maintenance-package")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class MaintenancePackageController {
  constructor(
    private readonly packageService: MaintenancePackageService,
    private readonly mail: MaintenanceMailService,
  ) {}

  @Get(":id/download")
  @Header("Cache-Control", "private, no-store")
  async download(@Param("id") id: string) {
    const packageFile = await this.packageService.assemble(id, "download");
    return new StreamableFile(packageFile.bytes, {
      type: "application/zip",
      length: packageFile.bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(packageFile.fileName)}`,
    });
  }

  @Get(":id/mail")
  async preview(@Param("id") id: string) {
    const elonezet = await this.mail.preview(id);
    if (elonezet === null)
      throw new NotFoundException("A karbantartási lap nem található.");
    return elonezet;
  }

  @Post(":id/mail")
  async send(
    @Param("id") id: string,
    @Body() input: SendMaintenancePackageMailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    /*
      A CSOMAG ELŐSZÖR. Ha a kapu elutasít, level SEM épül -- ugyanaz a
      sorrend, mint a hibajegyes `HandoverMailController.send()`-ben.
    */
    const csomag = await this.packageService.assemble(id, "send");
    return this.mail.send({
      serviceJobId: id,
      subject: input.subject,
      message: input.message,
      actorUserId: user.id,
      package: csomag,
    });
  }
}
