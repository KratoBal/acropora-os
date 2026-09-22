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
import {
  MAIL_TEMPLATE_VARIABLES,
  isMailTemplateEvent,
  PERMISSIONS,
  unknownTemplateVariables,
  type AuthenticatedUser,
} from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";
import {
  DEFAULT_MATERIAL_REQUEST_CREATED_TEMPLATE,
  DEFAULT_MATERIAL_REQUEST_RECEIVED_TEMPLATE,
  DEFAULT_SERVICE_JOB_OPENED_TEMPLATE,
  DEFAULT_WORKSHEET_SEND_FOR_SIGNATURE_TEMPLATE,
  DEFAULT_WORKSHEET_SIGNED_TEMPLATE,
  MATERIAL_REQUEST_CREATED,
  MATERIAL_REQUEST_RECEIVED,
  SERVICE_JOB_OPENED,
  WORKSHEET_SEND_FOR_SIGNATURE,
  WORKSHEET_SIGNED,
} from "./ticket-mail.service.js";

export class SaveMailTemplateDto {
  @IsString() @MinLength(1) @MaxLength(300) subject!: string;
  @IsString() @MinLength(1) @MaxLength(10_000) body!: string;
}

/**
 * AZ ESEMENYHEZ TARTOZO KEZDO SZOVEG.
 *
 * NINCS `default` AG, es ez szandekos: egy uj esemeny felvetele a kozos
 * listaba MEGALLITJA a forditot itt. Egy `default` mellett az uj esemeny
 * csendben a MASIK esemeny sablonjat adna vissza -- es az a fajta hiba, ami
 * csak akkor derul ki, amikor valaki mar at is irta.
 */
function alapertelmezes(id: string) {
  switch (id) {
    case WORKSHEET_SIGNED:
      return DEFAULT_WORKSHEET_SIGNED_TEMPLATE;
    case SERVICE_JOB_OPENED:
      return DEFAULT_SERVICE_JOB_OPENED_TEMPLATE;
    case WORKSHEET_SEND_FOR_SIGNATURE:
      return DEFAULT_WORKSHEET_SEND_FOR_SIGNATURE_TEMPLATE;
    case MATERIAL_REQUEST_CREATED:
      return DEFAULT_MATERIAL_REQUEST_CREATED_TEMPLATE;
    case MATERIAL_REQUEST_RECEIVED:
      return DEFAULT_MATERIAL_REQUEST_RECEIVED_TEMPLATE;
    default:
      throw new NotFoundException("Nincs ilyen levélsablon.");
  }
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
    /*
      AZ ISMERT ESEMENYEK LISTAJA A KOZOS CSOMAGBOL JON, NEM EGY ITTENI
      SZTRINGBOL.

      2026-09-22-ig pontosan EGY azonositot fogadott el ez a vegpont. Balazs
      tobb sablont kert, es a lista attol tobb, hogy VAN kuldesi ut hozza --
      ezert a vegpont ugyanazt a listat kerdezi, amit a felulet valasztoja
      mutat. Ket masolat pontosan ott csuszna szet, ahol senki nem nezi: egy
      felveheto nev, amire semmi nem kuld.
    */
    if (!isMailTemplateEvent(id))
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
      ...(tarolt ?? alapertelmezes(id)),
      /*
        AZ ALAPERTELMEZES A TAROLT ERTEK MELLE MEGY, NEM HELYETTE.

        2026-09-21-ig a valasz a kettot EGYMAST KIZAROAN adta: vagy a tarolt
        sort, vagy a kodban allot. Az elso mentes utan tehat az alapertelmezes
        ELERHETETLENNE valt -- nem azert, mert eltunt (ott all a kodban), hanem
        mert semmi nem adta oda a szerkesztonek.

        EGYIRANYU AJTO VOLT: aki atirta a sablont, es vissza akart terni, nem
        tudott. Es a kar nem hangos -- a lap tovabbra is mukodik, csak egy
        lehetoseg nincs.

        MIERT NEM TORLO VEGPONT: egy `DELETE` a tarolt sort szuntetne meg, es
        ezzel a "ki es mikor irta at" nyomat is. A visszaallitas igy MENTES
        marad: lathato, szerzos, visszakereseheto -- es a szerkeszto latja, mit
        ment, mielott megnyomja.
      */
      defaultTemplate: alapertelmezes(id),
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
    if (!isMailTemplateEvent(id))
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
