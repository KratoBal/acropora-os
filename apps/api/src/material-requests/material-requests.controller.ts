import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateMaterialRequestDto,
  MaterialRequestCommentDto,
  MaterialRequestListQueryDto,
  MaterialRequestReassignDto,
  MaterialRequestReceiveItemsDto,
} from "./dto/material-request.dto.js";
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

  // -------------------------------------------------------------------------
  // V2 (docs/material-requests/v2-discovery.md). Explicit business actions,
  // no generic PATCH. Reads need `SERVICE_VIEW`, writes `SERVICE_MANAGE`; the
  // handler / leader / requester / capability rules are the service's, from
  // one state machine (`material-request-workflow.ts`). Every one is scoped
  // to the worksheets the caller can see, and internal-only.
  //
  // The static paths stand BEFORE `material-requests/:id`, so "overview" and
  // "summary" are never read as an id.

  /** The overview list: `view`, `status`, `q`, `cursor`. */
  @Get("material-requests/overview")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  overview(
    @Query() query: MaterialRequestListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(user, query);
  }

  /** The overview's status cards. */
  @Get("material-requests/summary")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.statusCounts(user);
  }

  /** Who a request can be handed to (active purchasing users). */
  @Get("material-requests/handler-options")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  handlerOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.service.handlerOptions(user);
  }

  @Get("material-requests/:id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, user);
  }

  /** "Én intézem a beszerzést". 409 with the current handler if someone was faster. */
  @Post("material-requests/:id/claim")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  claim(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.claim(id, user);
  }

  @Post("material-requests/:id/reassign")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  reassign(
    @Param("id") id: string,
    @Body() input: MaterialRequestReassignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reassign(id, input.handlerId, user);
  }

  /** "Megrendeltem". */
  @Post("material-requests/:id/order")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  order(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.order(id, user);
  }

  /** "Részben beérkezett": per-item totals or marks. */
  @Post("material-requests/:id/receive-items")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  receiveItems(
    @Param("id") id: string,
    @Body() input: MaterialRequestReceiveItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.receiveItems(id, input, user);
  }

  /**
   * "Beérkezett", returning the request. The V1 `.../receive` route above
   * does the same but keeps its V1 response (the pending list) for the
   * phones on the old bundle.
   */
  @Post("material-requests/:id/receive-all")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  receiveAll(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.receiveAll(id, user);
  }

  /** Visszavonás (requester or leader, before ordering). */
  @Post("material-requests/:id/cancel")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  cancel(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Post("material-requests/:id/comments")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  comment(
    @Param("id") id: string,
    @Body() input: MaterialRequestCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addComment(id, input.body, user);
  }
}
