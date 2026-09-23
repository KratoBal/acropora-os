import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateMaterialRequestDto } from "./dto/material-request.dto.js";
import { MaterialRequestsService } from "./material-requests.service.js";

/**
 * KULON KONTROLLER, NEM A `WorksheetsController` RESZE.
 *
 * A lap-fuggo (`worksheets/:worksheetId/material-requests`) es a
 * FUGGETLEN (`material-requests`, `material-requests/:id/receive`) vegpontok
 * EGY MODULBAN elnek, mert egy KEPESSEG-ellenorzest (nem szerep-alapu
 * dontest) osztanak meg -- ez a mar amugy is nagy `WorksheetsController`-t
 * (700+ sor) nem bovitette volna szebben, mint egy uj, sajat kontroller.
 */
@Controller("service")
export class MaterialRequestsController {
  constructor(private readonly service: MaterialRequestsService) {}

  @Get("worksheets/:worksheetId/material-requests")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  listForWorksheet(
    @Param("worksheetId") worksheetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listForWorksheet(worksheetId, user);
  }

  @Post("worksheets/:worksheetId/material-requests")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Param("worksheetId") worksheetId: string,
    @Body() input: CreateMaterialRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(worksheetId, input, user);
  }

  /**
   * A KULDES -- KULON LEPES A FELVITELTOL. Csak a SAJAT piszkozat kuldheto
   * el (lasd `MaterialRequestsService.submit`); a `worksheetId` nem kell
   * az utvonalba, mert az igeny sajat azonositoja mar egyertelmu.
   */
  @Post("material-requests/:id/submit")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  submit(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.submit(id, user);
  }

  /**
   * A BESZERZO SAJAT LISTAJA. A `SERVICE_MANAGE` csak azt mondja meg, hogy a
   * hivo egyaltalan irhat-e munkalapra -- hogy LATJA-e EZT a listat, azt a
   * szolgaltatas donti el a `MATERIAL_REQUEST_MARK_RECEIVED` kepesseg alapjan
   * (lasd `MaterialRequestsService.listPending`).
   */
  @Get("material-requests")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listPending(user);
  }

  @Post("material-requests/:id/receive")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  receive(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.receive(id, user);
  }

  /**
   * AZ ELOZMENYEK -- UGYANAZON A LAPON, MINT A "RAM VARO" LISTA, kulon
   * utvonalon: a lehivo logika mas (`OPEN` ES `RECEIVED`, nem csak `OPEN`),
   * es a valasz-alak is mas tipus (lasd `MaterialRequestsService.listHistory`).
   */
  @Get("material-requests/history")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  listHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listHistory(user);
  }
}
