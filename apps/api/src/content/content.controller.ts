import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

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
 * A JOGOK HÁROM SZINTEN ÁLLNAK, és a `move` az egyetlen, ami nem egyetlen
 * jogot kér: a jóváhagyás és a kiküldésre bocsátás `content.approve`, minden
 * más lépés `content.manage`. A kettő szétválasztása a KAPU maga -- egy közös
 * jog azt jelentené, hogy aki írja, jóvá is hagyhatja.
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
   * A JOG A CÉLÁLLAPOTTÓL FÜGG: a jóváhagyás és a kiküldésre bocsátás
   * `content.approve`, minden más `content.manage`. Ezt a szolgáltatás nem
   * tudja eldönteni, mert a jogot a keret ellenőrzi a hívás ELŐTT -- ezért két
   * végpont van, nem egy.
   */
  @Post(":id/move")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  move(
    @Param("id") id: string,
    @Body() input: ContentMoveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void user;
    return this.service.move({ id, ...input });
  }

  /**
   * A JÓVÁHAGYÓ LÉPÉSEK KÜLÖN VÉGPONTON, KÜLÖN JOG ALATT.
   *
   * MIÉRT NEM EGY VÉGPONT EGY JOGGAL: a jogot a keret a hívás előtt
   * ellenőrzi, a célállapotot viszont a törzs hordozza. Egy közös végpont vagy
   * a szigorúbb jogot kérné mindenre (és akkor a szerző sem tudna vázlatot
   * lektorálásra adni), vagy az enyhébbet (és akkor a jóváhagyási kapu eltűnne).
   * A kettő szétválasztása a kapu maga.
   */
  @Post(":id/approve-move")
  @RequirePermissions(PERMISSIONS.CONTENT_APPROVE)
  approveMove(@Param("id") id: string, @Body() input: ContentMoveDto) {
    return this.service.move({ id, ...input });
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
