import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { RICH_TEXT_IMAGE_ID } from "@acropora/rich-text";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { memoryStorage } from "multer";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../../auth/decorators/require-permissions.decorator.js";
import { MailImageRepository } from "./mail-image.repository.js";
import {
  MAIL_IMAGE_MAX_BYTES,
  MailImageService,
} from "./mail-image.service.js";

/**
 * A LEVELSABLON KEPEI: feltoltes, lista, tartalom.
 *
 * A FELTOLTES UGYANAZ A JOG, MINT A SABLONE (`SETTINGS_MANAGE`): aki a sablont
 * irhatja, az tolthet bele kepet. Az OLVASAS (lista, tartalom) a szamlalevel
 * drawerebol is kell (`BILLING_RESEND`, 2026-10-01): az a felhasznalo a sablon
 * kepet amugy is kikuldi, tehat a megjelenites nem ad uj informaciot, a
 * feltoltes viszont a sablont modositana. A tartalom-vegpont is hitelesitett -- a szerkeszto es az
 * elonezet a sajat tokenjevel tolti be, a levelbe pedig mellekletkent megy.
 * Publikus kep-cim nincs, es nem is kell.
 */
@Controller("notifications/mail-images")
export class MailImageController {
  constructor(
    private readonly service: MailImageService,
    private readonly repository: MailImageRepository,
  ) {}

  /*
    OLVASAS: a Levelezes oldal (settings.manage) ES a szamlalevel drawere
    (billing.resend) is. A feltoltes marad settings.manage (acrobot 25433).
  */
  @Get()
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.BILLING_RESEND)
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      /*
        A HATAR A FELTOLTESNEL IS ALL, NEM CSAK A VIZSGALATNAL: enelkul egy
        tobb szaz megas fajl eloszor a memoriaba kerulne, es csak utana
        derulne ki, hogy tul nagy.
      */
      limits: { fileSize: MAIL_IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő kép kötelező.");
    return this.service.upload(file, user.id);
  }

  @Get(":id/content")
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.BILLING_RESEND)
  @Header("Cache-Control", "private, max-age=3600")
  async content(@Param("id") id: string) {
    if (!RICH_TEXT_IMAGE_ID.test(id))
      throw new NotFoundException("Nincs ilyen kép.");
    const [kep] = await this.repository.contents([id]);
    if (!kep) throw new NotFoundException("Nincs ilyen kép.");
    return new StreamableFile(Buffer.from(kep.bytes), {
      type: kep.contentType,
      length: kep.bytes.byteLength,
    });
  }
}
