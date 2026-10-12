import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { OutgoingPackageService } from "./outgoing-package.service.js";

/**
 * A HAVI KIMENŐ KÖNYVELŐI CSOMAG (hétfői lista N1). A jog a bejövő könyvelői
 * csomagé (`finance.manage`), mert ugyanannak a kezelőnek szól; a lekérés csak
 * olvas, mellékhatása nincs.
 */
@Controller("billing/outgoing-package")
export class OutgoingPackageController {
  constructor(private readonly outgoing: OutgoingPackageService) {}

  @Get(":month")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  async download(@Param("month") month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new BadRequestException("A hónap alakja ÉÉÉÉ-HH.");
    const { fileName, content } = await this.outgoing.build(month);
    return new StreamableFile(content, {
      type: "application/pdf",
      length: content.length,
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
