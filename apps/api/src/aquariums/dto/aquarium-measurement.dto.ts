import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";
import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

/**
 * A PARAMÉTER-KÓDOK A KÖZÖS KATALÓGUSBÓL JÖNNEK, NEM MÁSOLVA.
 *
 * Az API szabadon importálhatja a `@acropora/types` csomagot (a mobil app
 * az, ami nem -- lásd `docs/MOBILE-DEVELOPMENT.md`), tehát itt nincs
 * helye egy második, kézzel írt listának, ami elcsúszhatna a katalógustól.
 */
const PARAMETER_CODES = AQUARIUM_MEASUREMENT_PARAMETERS.map(
  (param) => param.code,
);

export class CreateAquariumMeasurementValueDto {
  @IsIn(PARAMETER_CODES) parameterCode!: string;
  @Type(() => Number) @IsNumber() value!: number;
}

/**
 * EGY PARAMÉTER SAJÁT CÉLTARTOMÁNYA EGY AKVÁRIUMON -- lásd az
 * `AquariumMeasurementTarget` (`@acropora/types`) fejlécét.
 *
 * MIND A `min`, MIND A `max` ELHAGYHATÓ, EGYMÁSTÓL FÜGGETLENÜL -- a
 * kereszt-ellenőrzést (legalább az egyik megadva, `min <= max`) NEM ide
 * tettük: a service-ben, a szerződés-tételek (`ContractsService.normalize`)
 * mintájára, mert ott adható vissza a magyar hibaüzenet a PONTOS
 * paraméterre, amelyik hibás -- egy class-validator dekorátor csak azt
 * tudná mondani, hogy "az egyik elem rossz", nem hogy melyik.
 */
export class AquariumMeasurementTargetDto {
  @IsIn(PARAMETER_CODES) parameterCode!: string;
  @Type(() => Number) @IsNumber() @IsOptional() min?: number;
  @Type(() => Number) @IsNumber() @IsOptional() max?: number;
}

/**
 * EGY MÉRÉSI ALKALOM FELVITELE, TÖBB PARAMÉTERREL.
 *
 * Balázs kérése (2026-09-24): "egy mérés = egy mérési alkalom, több
 * paraméterrel". A szerver ebből ANNYI `AquariumMeasurement` sort ír, ahány
 * elem a `values` tömbben áll, mindegyiket UGYANAZZAL a `measuredAt`-tel --
 * lásd `aquarium-measurements.repository.ts` fejlécét.
 */
export class CreateAquariumMeasurementDto {
  /**
   * A KLIENS ÁLTAL ADOTT MŰVELET-AZONOSÍTÓ, A HELYSZÍNI RÖGZÍTÉS
   * IDEMPOTENCIA-KULCSA -- ugyanaz az alak, mint az akvárium felvitelénél
   * (`CreateAquariumDto.clientOperationId`). ELHAGYHATÓ: a webes felvitel
   * nem küld kulcsot.
   */
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.",
  })
  @IsOptional()
  clientOperationId?: string;

  /** ELHAGYHATÓ: a mai időpontra esik, ha a hívó nem küld sajátot -- lásd a
   * megosztott `CreateAquariumMeasurementInput` fejlécét, miért kell mégis
   * mező (a telefonos, később felküldött mérésnél a rögzítés pillanata
   * számít, nem a feltöltés ideje). */
  @IsDateString() @IsOptional() measuredAt?: string;
  @IsString() @IsOptional() source?: string;
  @IsString() @IsOptional() notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateAquariumMeasurementValueDto)
  values!: CreateAquariumMeasurementValueDto[];
}

/**
 * EGY MÉRÉSI ALKALOM TELJES CSERÉJE A KARBANTARTÓ-LISTÁN.
 *
 * Balázs kérése (2026-09-24 14:41): "a belsős kollégák közül lehessen
 * választani akár többet is". Csere-alakú (nem hozzáadás/eltávolítás),
 * ugyanúgy, mint a munkalap felelős-listája (`SetWorksheetAssigneesDto`) --
 * a felület egyetlen "mentés" gombbal küldi a teljes, kívánt végállapotot.
 */
export class SetAquariumMaintainersDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  userIds!: string[];
}
