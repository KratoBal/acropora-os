import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  BadRequestException,
} from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  MAIL_TEMPLATE_VARIABLES,
  unknownTemplateVariables,
} from "./mail-template.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";
import {
  DEFAULT_WORKSHEET_SIGNED_TEMPLATE,
  WORKSHEET_SIGNED,
} from "./ticket-mail.service.js";

export class SaveMailTemplateDto {
  @IsString() @MinLength(1) @MaxLength(300) subject!: string;
  @IsString() @MinLength(1) @MaxLength(10_000) body!: string;
}

/**
 * A SABLON OLVASASA ES IRASA -- A SZERKESZTO FELULET EZEN FOGJA MEGFOGNI.
 *
 * A FELULETET NEM EPITEM MEG (acrobot kikotese, 2026-09-21): az webes munka es
 * kulon kartyat kap.
 *
 * A VALTOZO-LISTA A SABLONNAL EGYUTT UTAZIK, es ez a fontos resz. acrobot
 * szerint a negy kikotese kozul ez a legfontosabb: "egy behelyettesito nyelv,
 * aminek a szotara nincs kiirva, hasznalhatatlan". Ha a felulet kezzel irt
 * listat mutatna, az elso uj valtozonal ketté valna a motortol -- igy
 * SZERKEZETILEG nem tud elcsuszni.
 */
@Controller("notifications/mail-templates")
export class MailTemplateController {
  constructor(private readonly repository: TicketMailRepository) {}

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async read(@Param("id") id: string) {
    if (id !== WORKSHEET_SIGNED)
      throw new NotFoundException("Nincs ilyen levélsablon.");
    const tarolt = await this.repository.template(id);
    return {
      id,
      /*
        A TAROLT SOR HIANYA NEM HIBA: amig senki nem irt sajatot, a kodban allo
        alapertelmezes el. A `source` mezo megmondja, MELYIKET latja a
        szerkeszto -- enelkul az elso mentes elott nem derulne ki, hogy amit
        olvas, azt meg senki nem irta.
      */
      source: tarolt ? "stored" : "default",
      ...(tarolt ?? DEFAULT_WORKSHEET_SIGNED_TEMPLATE),
      variables: MAIL_TEMPLATE_VARIABLES,
    };
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async save(
    @Param("id") id: string,
    @Body() input: SaveMailTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (id !== WORKSHEET_SIGNED)
      throw new NotFoundException("Nincs ilyen levélsablon.");

    /*
      AZ ELGEPELT VALTOZO ITT DERUL KI, NEM A VEVO LEVELEBEN.

      Ugyanaz a motor meri, ami kuldeskor helyettesit, tehat a ket valasz nem
      tud elcsuszni. Enelkul egy elgepelt nev csak a kovetkezo valodi kuldeskor
      bukna ki, amikor mar senki nem emlekszik ra, hogy a sablont atirtak.
    */
    const ismeretlen = [
      ...unknownTemplateVariables(input.subject),
      ...unknownTemplateVariables(input.body),
    ];
    if (ismeretlen.length)
      throw new BadRequestException(
        `Ismeretlen változó a sablonban: ${[...new Set(ismeretlen)].join(", ")}. A használható változók: ${MAIL_TEMPLATE_VARIABLES.map((v) => v.name).join(", ")}.`,
      );

    await this.repository.saveTemplate({
      id,
      subject: input.subject,
      body: input.body,
      updatedByUserId: user.id,
    });
    return { ok: true };
  }
}
