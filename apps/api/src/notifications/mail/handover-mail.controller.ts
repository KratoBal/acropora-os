import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { partnerScopeOf } from "../../auth/partner-scope.util.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ServiceJobPackageService } from "../../service-jobs/service-job-package.service.js";
import { HandoverMailService } from "./handover-mail.service.js";

export class SendHandoverMailDto {
  /**
   * A TARGY ELHAGYHATO: ha nem jon, az elotoltott mondat megy
   * ("A <jegyszam> szamu hibajegyet lezartuk."). A felulet elore kitolti, a
   * kezelo atirhatja -- Balazs specje szerint.
   */
  @IsString() @IsOptional() @MaxLength(200) subject?: string;

  /**
   * AZ UZENET KOTELEZO, ES EZ DONTES.
   *
   * Egy ures torzsu level a vevonek egy csatolmany magyarazat nelkul. A
   * kikuldest EMBER inditja, ugyanabban a percben -- tehat van mit irnia.
   */
  @IsString() @MinLength(1) @MaxLength(4000) message!: string;
}

/**
 * A LEZART HIBAJEGY KIKULDESE.
 *
 * === EZ A VEGPONT LATJA MIND A KETTOT, ES EZERT ITT ALL ===
 *
 * A csomagot a `ServiceJobPackageService` gyartja, a levelet a
 * `HandoverMailService` kuldi. A ket modul kozott KORKOROS lenne a fugges, ha
 * a levelkuldo injektalna a csomag-szolgaltatast (`service-jobs.module.ts` mar
 * importalja a `NotificationsModule`-t).
 *
 * Ezert a vegpont HIVJA le a csomagot, es ADJA AT. A fajl a `notifications/mail`
 * alatt all (oda tartozik fogalmilag), de a `ServiceJobsModule` REGISZTRALJA --
 * mert ott all mind a ket fuggoseg. A ketto nem ugyanaz a kerdes.
 *
 * === A JOG: `SERVICE_MANAGE`, ES A HATOKOR A CSOMAG-SZOLGALTATASE ===
 *
 * A `download()` maga szur hatokorre (`partnerScopeOf`), tehat a jegy
 * lathatosaga ott dol el, nem itt. Ez a sor a MUVELET jogat koveteli meg: a
 * kikuldes iras-jellegu lepes, nem olvasas.
 */
@Controller("service/jobs")
export class HandoverMailController {
  constructor(
    private readonly packageService: ServiceJobPackageService,
    private readonly mail: HandoverMailService,
  ) {}

  /**
   * KI KAPNA MEG A LEVELET -- A DIALOGUS MEGNYITASAKOR.
   *
   * === BELSOS HATOKORRE ZARVA, ES EZ A LENYEGE ===
   *
   * A valasz E-MAIL CIMEKET szallit (Balazs specje: az ablakban "latszik a
   * cimzett, cimzettek neve, email cime"). A `SERVICE_MANAGE` jog ONMAGABAN
   * NEM SZUKIT: a `PARTNER_SERVICE` szerep VISELI (merve a jog-tablaban,
   * `packages/types/src/auth.ts`). Egy partner-fiok tehat a puszta jog alapjan
   * elerne egy olyan vegpontot, ami a vevo portal-fiokjainak cimet adja.
   *
   * A rendszer tobbi resze ugyanezt a hatart tartja, es nem veletlenul: a jegy
   * naplo-sora SZANDEKOSAN cim nelkuli, a `customerContacts` valaszto-lista
   * pedig `id` es `displayName` mezovel megy. Ha ez az egy vegpont tagabb
   * lenne, az egesz dontes megkerulheto volna rajta keresztul.
   *
   * === A LATHATOSAGI SZURO EZERT NEM SZEREPEL KULON ===
   *
   * A `serviceJobVisibilityFor` BELSOS hivonal URES szurot ad (a fuggveny
   * elso aga: `if (scope.kind === "internal") return {}`). Mivel ide csak
   * belsos hivo jut el, a szuro itt azonossag lenne.
   *
   * HA EZ A VEGPONT VALAHA MEGNYILIK A PARTNER ELOTT, a szurot BE KELL
   * EPITENI -- kulonben egy partner barmelyik jegy azonositojara megkapna a
   * cimzetteket. A kapu meglete ezert nem stilus: egy nevesitett allitas
   * meri, es a rontasa nev szerint pirosra valt.
   */
  @Get(":id/mail")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  async preview(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (partnerScopeOf(user).kind !== "internal")
      throw new ForbiddenException(
        "A kiküldés címzettjeit csak belsős felhasználó nézheti meg.",
      );
    const elonezet = await this.mail.preview(id);
    if (elonezet === null)
      throw new NotFoundException("A hibajegy nem található.");
    return elonezet;
  }

  @Post(":id/mail")
  @RequirePermissions(PERMISSIONS.SERVICE_MANAGE)
  async send(
    @Param("id") id: string,
    @Body() input: SendHandoverMailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    /*
      A CSOMAG ELOSZOR. Ha a jegy nem letezik vagy nem kesz, a `download()`
      dob -- es akkor level SEM epul. A sorrend szandekos: egy elkuldott
      level utan mar nem lehet megallapitani, hogy a csomag hianyos volt.
    */
    const csomag = await this.packageService.download(id, user);
    return this.mail.send({
      serviceJobId: id,
      subject: input.subject,
      message: input.message,
      actorUserId: user.id,
      package: csomag,
    });
  }
}
