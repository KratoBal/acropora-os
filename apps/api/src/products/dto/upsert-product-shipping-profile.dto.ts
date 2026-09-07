import { IsBoolean } from "class-validator";

/**
 * A NEGY JELZO MIND KOTELEZO, ES EZ A SEMA DONTESENEK A FOLYTATASA.
 *
 * A `ProductShippingProfile` tablan egyik oszlopnak SINCS alapertelmezett
 * erteke, mert a hianyzo ertek nem "nem", hanem "meg senki nem nezte meg". Ha a
 * DTO barmelyik mezot opcionalissa tenne, ez a dontes CSENDBEN felborulna: egy
 * reszleges kereskor a ki nem toltott jelzo vagy hibat dobna a tarolo szintjen,
 * vagy -- ami rosszabb -- valaki `@IsOptional`-lel es egy `?? false`
 * alapertelmezessel "javitana meg", es onnantol egy meg nem vizsgalt jellemzo
 * ugyanugy nezne ki, mint egy megvizsgalt nemleges.
 *
 * A kotelezoseg tehat nem szigor, hanem ugyanannak az egy allitasnak a masodik
 * fele: aki ezt a rekordot irja, MIND A NEGYROL dont.
 */
export class UpsertProductShippingProfileDto {
  /** Az egesz kosarat uzletben kell atvenni. */
  @IsBoolean() pickupOnly!: boolean;
  /** A Foxpost nem ajanlhato fel. */
  @IsBoolean() foxpostForbidden!: boolean;
  /** Nehez aru -- KEZZEL jelolt, sosem a sulybol. */
  @IsBoolean() isHeavy!: boolean;
  /** Fagyasztott: nem szallithato, `pickupOnly`-kent viselkedik. */
  @IsBoolean() isFrozen!: boolean;
}
