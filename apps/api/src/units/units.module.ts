import { Module } from "@nestjs/common";

import { UnitsController } from "./units.controller.js";
import { UnitsRepository } from "./units.repository.js";
import { UnitsService } from "./units.service.js";

/**
 * SAJAT MODUL, ES NEM A `service-assets` ALATT.
 *
 * A mertekegyseg-torzsadat MA az eszkoz teljesitmenyet szolgalja ki, de a
 * modell epp azert keszult fajtaval, hogy kesobb a munkalap (es barmi mas) is
 * ugyanezt hasznalja. A `service-assets` ala teve a kovetkezo hivo
 * KERESZT-MODUL kolcsonzesnek latszana, holott kozos torzsadatrol van szo.
 */
@Module({
  controllers: [UnitsController],
  providers: [UnitsRepository, UnitsService],
  exports: [UnitsRepository],
})
export class UnitsModule {}
