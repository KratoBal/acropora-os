import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import {
  CreateServiceJobDto,
  MoveServiceJobDto,
  ServiceJobListQueryDto,
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
  list(@Query() query: ServiceJobListQueryDto) {
    return this.service.list(query);
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
