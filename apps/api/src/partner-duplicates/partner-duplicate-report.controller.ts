import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  PartnerDuplicateReportService,
  type PartnerDuplicateResponse,
} from "./partner-duplicate-report.service.js";

/**
 * A PARTNER-DUPLIKÁTUMOK LISTÁJA (egy partnertörzs, 1. lépés), CSAK OLVASÁS, `settings.manage` joggal. A lista neveket és
 * adószámokat tartalmaz: jogosult felhasználónak jelenik meg, a flottának és a Discordnak csak a naplósor számai mennek.
 */
@Controller("admin/partner-duplicates")
export class PartnerDuplicateReportController {
  constructor(private readonly service: PartnerDuplicateReportService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  report(): Promise<PartnerDuplicateResponse> {
    return this.service.build();
  }
}
