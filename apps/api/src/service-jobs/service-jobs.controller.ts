import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import {
  AttachWorksheetDto,
  CreateServiceJobDto,
  MoveServiceJobDto,
  ServiceJobListQueryDto,
  SetServiceJobPartnerDto,
  AssignVisibilityUnitDto,
} from "./dto.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A HIBAJEGY MODUL ELSŐ SZELETE: felvitel és lista.
 *
 * A jogosultság a SZERVIZÉ (`service.view` / `service.manage`), nem külön
 * hibajegy-jog. A hibajegy és a munkalap ugyanannak a munkának a két oldala,
 * és aki az egyiket viszi, a másikat is - egy külön jogkör ma csak azt
 * jelentené, hogy valakinél elfelejtjük bekapcsolni.
 *
 * AMI EBBEN A SZELETBEN NINCS, ÉS SZÁNDÉKOSAN: az állapotváltás, a részletlap
 * és a munkalap-csatolás. Az utóbbi kettő két meglévő oldalt köt össze, tehát
 * akkor van értelme, amikor mindkettő áll.
 *
 * ÉS AMI NEM KÉSZÜLT EL: a PARTNER FELÉ MENŐ ÉRTESÍTÉS. A négy látszó állapot
 * megvan (`service-job-status.ts`), de értesítési út ma nem létezik a
 * rendszerben - se email, se partner-címzett a push-ban. A leképezés a
 * felületnek is kell, tehát önmagában is hasznos; az értesítés külön tétel.
 */
@Controller("service/jobs")
export class ServiceJobsController {
  constructor(private readonly service: ServiceJobsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  list(
    @Query() query: ServiceJobListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(query, user);
  }

  /**
   * A LATHATOSAGI HOZZARENDELESEK -- KONKRET UT, A `:id` ELE.
   *
   * A `:id` mintat a `visibility` szo kulonben elnyelne, es a hibajegy-reszletlap
   * probalna feloldani egy felhasznalo-azonositot. Ugyanaz a sorrend-szabaly,
   * amit a fajl mar kimond a `@Get(":id")` folott.
   *
   * SAJAT JOGKOR, NEM `service.manage`: ez azt szabalyozza, KI MIT LAT, nem azt,
   * hogy mi tortenik egy jeggyel. A MANAGER szandekosan NEM kapja meg (lasd az
   * `auth.ts` tiltolistajat es a hozza tartozo allitast).
   */
  @Get("visibility/:userId")
  @RequirePermissions(PERMISSIONS.SERVICE_VISIBILITY_ASSIGN)
  listAssignments(@Param("userId") userId: string) {
    return this.service.listAssignments(userId);
  }

  @Post("visibility/:userId")
  @RequirePermissions(PERMISSIONS.SERVICE_VISIBILITY_ASSIGN)
  assignUnit(
    @Param("userId") userId: string,
    @Body() body: AssignVisibilityUnitDto,
  ) {
    return this.service.assignUnit(userId, body.departmentId);
  }

  @Delete("visibility/:userId/:departmentId")
  @RequirePermissions(PERMISSIONS.SERVICE_VISIBILITY_ASSIGN)
  unassignUnit(
    @Param("userId") userId: string,
    @Param("departmentId") departmentId: string,
  ) {
    return this.service.unassignUnit(userId, departmentId);
  }

  /**
   * A RÉSZLETLAP `SERVICE_VIEW` ALATT ÁLL, nem `SERVICE_MANAGE` alatt: aki a
   * listát látja, a jegyet is elolvashatja. A lépés az, ami kezelői jog.
   *
   * A `:id` útvonal a `@Get()` UTÁN áll, de a konkrét utak (ha lesznek) elé
   * kell kerülniük, különben a `:id` elnyeli őket.
   */
  @Get(":id")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  create(
    @Body() input: CreateServiceJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  /**
   * A PARTNER BEALLITASA. `SERVICE_MANAGE`, mert a jegy adatat valtoztatja --
   * es csak ott, ahol MEG NINCS partner: a csere atsorolas, arra nincs ut.
   */
  @Post(":id/partner")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  setPartner(@Param("id") id: string, @Body() input: SetServiceJobPartnerDto) {
    return this.service.setPartner(id, input.customerId);
  }

  /**
   * A CSATOLAS A JEGY OLDALAN ALL, NEM A LAPEN, es ez a folyamatot koveti: a
   * felelos letrehozza a jegyet, es hozzaveszi a mar meglevo lapot. A
   * valaszto-listat viszont a munkalap-modul adja (`GET
   * /service/worksheets/attachable`), mert az a tudas ott lakik.
   */
  @Post(":id/worksheets")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  attachWorksheet(@Param("id") id: string, @Body() input: AttachWorksheetDto) {
    return this.service.attachWorksheet(id, input.worksheetId);
  }

  /**
   * A LEVALASZTAS, mert a csatolas kulonben visszafordithatatlan lenne: egy
   * legordulobol valasztunk, sorszam nelkuli lapok kozul is.
   */
  @Delete(":id/worksheets/:worksheetId")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  detachWorksheet(
    @Param("id") id: string,
    @Param("worksheetId") worksheetId: string,
  ) {
    return this.service.detachWorksheet(id, worksheetId);
  }

  /**
   * A LÉPÉS SAJÁT VÉGPONT, ÉS `SERVICE_MANAGE` ALATT ÁLL.
   *
   * Hogy egy sürgős jegy kihagyhatja-e a mérlegelést, azt az ÁTMENET-TÁBLA
   * engedi; hogy KI teheti meg, az ez a jogkör. A kettő szándékosan külön:
   * egy táblába gyúrva egy meg nem hozott döntést rögzítenénk.
   */
  @Post(":id/move")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  move(
    @Param("id") id: string,
    @Body() input: MoveServiceJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.move(id, input, user.id);
  }
}
