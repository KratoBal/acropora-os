import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ContentService } from "./content.service.js";
import {
  ContentCalendarQueryDto,
  ContentCommentDto,
  ContentMoveDto,
  ContentWaitingQueryDto,
} from "./dto/content.dto.js";

/**
 * A TARTALOM-SOR VÉGPONTJAI.
 *
 * A JOGOK HÁROM SZINTEN ÁLLNAK: az olvasás `content.view`, a lépések
 * `content.manage`, a jóváhagyói lépések pedig `content.approve` alatt.
 *
 * A KÉT VÉGPONT (`move` és `approve-move`) ÖNMAGÁBAN NEM KAPU, és ezt korábban
 * ez a fejléc tévesen állította. Mindkettő ugyanazt a szolgáltatás-metódust
 * hívja, tehát amíg a döntés a végpontválasztáson múlt, egy `content.manage`
 * jogú hívó a `/move` úton kiadhatta a jóváhagyást is. A KAPU MA A
 * SZOLGÁLTATÁSBAN VAN (`requiresApproval`), ott, ahol a célállapot is ismert;
 * a két végpont attól hasznos, hogy a keret a jogtalan hívást olcsóbban
 * elutasítja, mint mi -- de nem attól, hogy elválasztja a döntést.
 */
@Controller("content")
export class ContentController {
  constructor(private readonly service: ContentService) {}

  /**
   * A LISTA ALAPÉRTELMEZETT NÉZETE: ami RÁM vár. Balázs kérése szó szerint:
   * „minden felkerul ami rank var".
   */
  @Get("waiting")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  waiting(
    @Query() query: ContentWaitingQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.waitingForMe(query.role, user.id);
  }

  /**
   * MI VÁR RÁM, SZEREP-VÁLASZTÁS NÉLKÜL.
   *
   * MIÉRT KÜLÖN VÉGPONT, ÉS NEM A `waiting` EGYIK SZEREPE: a `waiting` egy
   * SZEREP szemével kérdez, ez pedig a felhasználóéval. A kettő más bemenetet
   * vesz (ott a szerep, itt a jog és az azonosító) és más alakot ad vissza (ott
   * lista, itt lista PLUSZ az, amit a nézet nem fed le). Egy közös végpont a két
   * választ egy alakba kényszerítené, és a különbség pont abban tűnne el, ami
   * ebben a nézetben a legfontosabb.
   *
   * A JOGOT ITT OLVASSUK KI, nem a szolgáltatásban: a szűrő tiszta függvény
   * marad, mérhetően, adatbázis és keret nélkül.
   */
  @Get("waiting-on-me")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  waitingOnMe(@CurrentUser() user: AuthenticatedUser) {
    return this.service.waitingOnMe({
      userId: user.id,
      canApprove: hasPermission(user, PERMISSIONS.CONTENT_APPROVE),
    });
  }

  /**
   * AMI KÉPRE VÁR. Külön végpont, nem a `waiting` egyik szűrője: a kép a
   * szövegtől független feltétel, és ma NÉGY kész szövegű poszt áll pontosan
   * itt, 2026-08-18 óta (a szám és a határa a `content-state.ts` fejlécében).
   */
  @Get("waiting-for-image")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  waitingForImage() {
    return this.service.waitingForImage();
  }

  @Get("calendar")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  calendar(@Query() query: ContentCalendarQueryDto) {
    return this.service.calendar(new Date(query.from), new Date(query.to));
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  /**
   * ÁLLAPOTVÁLTÁS, A HÍVÓ ÁLTAL HITT ÁLLAPOTTAL EGYÜTT.
   *
   * A `from` NEM felesleges: enélkül két ember egyszerre dönthetne ugyanarról a
   * tételről, és a második írás csendben felülírná az elsőt. Így a hívó
   * kimondja, mit LÁTOTT, és ha közben elmozdult, hibát kap.
   *
   * A JOG A CÉLÁLLAPOTTÓL FÜGG, ÉS EZT A SZOLGÁLTATÁS DÖNTI EL, NEM A VÉGPONT.
   *
   * Ez a mondat korábban az ellenkezőjét állította („ezért két végpont van, nem
   * egy"), és abból egy valódi rés lett: ez a végpont `content.manage` jogot
   * kér, a törzse viszont bármelyik célállapotot elfogadta, tehát a jóváhagyást
   * is. A dekorátor tehát a BELÉPÉST szabályozza, a LÉPÉST a szolgáltatás
   * (`requiresApproval`) -- aki jóváhagyói lépést kér jóváhagyói jog nélkül,
   * `403`-at kap, akkor is, ha ezen az úton jött be.
   */
  @Post(":id/move")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  move(
    @Param("id") id: string,
    @Body() input: ContentMoveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.move({
      id,
      ...input,
      actorCanApprove: hasPermission(user, PERMISSIONS.CONTENT_APPROVE),
    });
  }

  /**
   * A JÓVÁHAGYÓ LÉPÉSEK KÜLÖN VÉGPONTON, KÜLÖN JOG ALATT.
   *
   * MIÉRT MARAD KÉT VÉGPONT, HA A DÖNTÉS ÚGYIS A SZOLGÁLTATÁSBAN VAN: mert a
   * keret a jogtalan hívást a törzs futtatása ELŐTT utasítja el, és mert a
   * kliens így a saját jogából tudja, melyik utat kell hívnia -- nem a szerver
   * hibájából tanulja meg. A kapu viszont NEM ettől kapu: a végpontot a hívó
   * választja, a célállapotot pedig a törzs hordozza, tehát az elválasztás
   * önmagában csak addig véd, amíg a hívó jóhiszemű.
   */
  @Post(":id/approve-move")
  @RequirePermissions(PERMISSIONS.CONTENT_APPROVE)
  approveMove(
    @Param("id") id: string,
    @Body() input: ContentMoveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // A JOGOT ITT IS A FELHASZNÁLÓBÓL OLVASSUK, nem `true`-t adunk át.
    //
    // Egy beégetett `true` azt jelentené, hogy a szolgáltatás ellenőrzése ezen a
    // végponton csak addig ér valamit, amíg a `@RequirePermissions` dekorátor a
    // helyén van. Egy elgépelt vagy törölt dekorátor néma lyukat hagyna, és épp
    // azt a kaput, amiért ez a végpont külön létezik. Így a két ellenőrzés
    // FÜGGETLEN: mindkettőnek külön kell elromlania ahhoz, hogy baj legyen.
    return this.service.move({
      id,
      ...input,
      actorCanApprove: hasPermission(user, PERMISSIONS.CONTENT_APPROVE),
    });
  }

  @Post(":id/comments")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  comment(
    @Param("id") id: string,
    @Body() input: ContentCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.comment({
      contentId: id,
      authorId: user.id,
      body: input.body,
    });
  }
}
