import { Body, Controller, Param, Post } from "@nestjs/common";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
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
