import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AmendWorksheetDto,
  CreateWorksheetDepartmentDto,
  CreateWorksheetDto,
  SetWorksheetPartnerCodeDto,
  SignWorksheetVersionDto,
  UpdateWorksheetDraftDto,
  WorksheetListQueryDto,
} from "./dto/worksheet.dto.js";
import { WorksheetsService } from "./worksheets.service.js";

@Controller("service/worksheets")
export class WorksheetsController {
  constructor(private readonly service: WorksheetsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(@Query() query: WorksheetListQueryDto) {
    return this.service.list(query);
  }

  @Get("customers/:customerId/departments")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  departments(@Param("customerId") customerId: string) {
    return this.service.departments(customerId);
  }

  @Post("customers/:customerId/departments")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  createDepartment(
    @Param("customerId") customerId: string,
    @Body() input: CreateWorksheetDepartmentDto,
  ) {
    return this.service.createDepartment(customerId, input);
  }

  /**
   * A partner-rövidítés a munkalap-szám első tagja, ezért itt él és nem a
   * vevő-modulban: a mező kizárólag a számozás miatt létezik. Ha egyszer a
   * vevő adatlapján is szerkeszthető lesz, oda költözik.
   */
  @Put("customers/:customerId/partner-code")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setPartnerCode(
    @Param("customerId") customerId: string,
    @Body() input: SetWorksheetPartnerCodeDto,
  ) {
    return this.service.setPartnerCode(customerId, input);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Get(":id/versions/:version/diff")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  diff(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
  ) {
    return this.service.diff(id, version);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateWorksheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  updateDraft(@Param("id") id: string, @Body() input: UpdateWorksheetDraftDto) {
    return this.service.updateDraft(id, input);
  }

  @Post(":id/close")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  close(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.close(id, user.id);
  }

  /**
   * Lezárt munkalap módosítása. Külön jogkör: munkalapot írni és egy már
   * kiadott munkalapot átírni nem ugyanaz a felelősség.
   */
  @Post(":id/versions")
  @RequirePermissions(PERMISSIONS.SERVICE_WORKSHEET_AMEND)
  amend(
    @Param("id") id: string,
    @Body() input: AmendWorksheetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.amend(id, input, user.id);
  }

  @Post(":id/sign")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  sign(
    @Param("id") id: string,
    @Body() input: SignWorksheetVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sign(id, input, user.id);
  }
}
