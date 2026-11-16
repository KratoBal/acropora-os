import { Transform } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const DIFFICULTIES = ["KONNYU", "KOZEPES", "HALADO", "SZAKERTO"] as const;
const NEEDS = ["GYENGE", "KOZEPES", "EROS", "NEM_ERTELMEZHETO"] as const;
const REEF_SAFE = [
  "IGEN",
  "NEM",
  "FELTETELES",
  "ALLITAS_NELKULI",
  "NEM_FAJ_SZINTU",
] as const;
const SOCIAL = [
  "EGYEDUL",
  "PARBAN",
  "CSOPORTBAN",
  "TOBB_PELDANY_TARTHATO",
] as const;
const AGGRESSION = [
  "BEKES",
  "TERULETVEDO",
  "RAGADOZO",
  "CSALANOZ",
  "FAJTARSSAL_AGRESSZIV",
  "FELTETELES",
] as const;
const FEEDING = [
  "SZURO_PLANKTON",
  "ALGAEVO",
  "HUSEVO",
  "MINDENEVO",
  "TORMELEKEVO",
  "FOTOSZINTETIZALO",
  "TISZTOGATO",
] as const;
const DIMENSIONS = [
  "TESTHOSSZ",
  "KARFESZTAVOLSAG",
  "HEJMERET",
  "TELJES_KITERJEDES",
] as const;
const ZONES = ["ALSO", "KOZEPSO", "FELSO"] as const;
const SOURCING = ["TENYESZTETT", "VADFOGAS"] as const;

/**
 * THE HUSBANDRY BLOCK'S WRITE (V2.2, card d2fc06e7; `PATCH /products/:id/husbandry`).
 *
 * Every key is optional and `null` clears the fact ("being checked", not a default). The Hungarian name is NOT here: it is
 * written through `PATCH /products/:id/names`. The checks that need the stored row (the first step never to an Acropora
 * genus, the forbidden words, the verification's source) are the service's (`product-husbandry.ts`); this class checks
 * only the shape. The global ValidationPipe (whitelist + forbidNonWhitelisted) rejects any other key.
 *
 * `ellenorizve: true` verifies the facts as they are after this write (the SERVER stamps who and when; nobody can send a
 * name or a time); `false` withdraws the verification. A write that touches a fact and does not verify withdraws the
 * earlier verification: the new content was not verified by anyone.
 */
export class UpdateProductHusbandryDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  genus?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  species?: string | null;

  @IsOptional()
  @IsIn(DIFFICULTIES)
  careDifficulty?: (typeof DIFFICULTIES)[number] | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  minLiter?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  medenceErettsegHonap?: number | null;

  @IsOptional()
  @IsIn(ZONES)
  elhelyezesZona?: (typeof ZONES)[number] | null;

  @IsOptional()
  @IsIn(REEF_SAFE)
  reefSafe?: (typeof REEF_SAFE)[number] | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  reefSafeIndok?: string | null;

  @IsOptional()
  @IsIn(SOCIAL)
  socialKeeping?: (typeof SOCIAL)[number] | null;

  @IsOptional()
  @IsArray()
  @IsIn(AGGRESSION, { each: true })
  aggression?: (typeof AGGRESSION)[number][] | null;

  @IsOptional()
  @IsBoolean()
  korallevo?: boolean | null;

  @IsOptional()
  @IsBoolean()
  gerinctelenevo?: boolean | null;

  @IsOptional()
  @IsArray()
  @IsIn(FEEDING, { each: true })
  feedingType?: (typeof FEEDING)[number][] | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(200)
  etetesGyakorisag?: string | null;

  @IsOptional()
  @IsBoolean()
  eloEleseg?: boolean | null;

  @IsOptional()
  @IsIn(NEEDS)
  fenyIgeny?: (typeof NEEDS)[number] | null;

  @IsOptional()
  @IsIn(NEEDS)
  aramlasIgeny?: (typeof NEEDS)[number] | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  meretMax?: number | null;

  @IsOptional()
  @IsIn(DIMENSIONS)
  meretDimenzio?: (typeof DIMENSIONS)[number] | null;

  @IsOptional()
  @IsIn(SOURCING)
  szarmazas?: (typeof SOURCING)[number] | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  kinekNem?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  forrasTipus?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  forrasHivatkozas?: string | null;

  /*
    THE OPTIONAL FACTS (V2.2 S1b): ranges, lifespan, sting or venom and its handling warning, quarantine and acclimatization,
    breeding in the tank. Every key optional, `null` clears; the cross-field rules (a range's ends, the warning a sting needs) are
    the decision's (`product-husbandry.ts`).
  */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(40)
  tempMinC?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(40)
  tempMaxC?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  @Max(1.04)
  salinityMinSg?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  @Max(1.04)
  salinityMaxSg?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(30)
  khMinDkh?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(30)
  khMaxDkh?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  lifespanYears?: number | null;

  @IsOptional()
  @IsBoolean()
  stingOrVenom?: boolean | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  handlingWarning?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(52)
  quarantineWeeks?: number | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  acclimatization?: string | null;

  @IsOptional()
  @IsBoolean()
  breedsInTank?: boolean | null;

  @IsOptional()
  @IsBoolean()
  ellenorizve?: boolean;

  /** The version the caller saw (`ProductHusbandry.version`): required with `ellenorizve: true`, checked by the decision. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  seenVersion?: string;
}

/** The text without the surrounding spaces; what is not text stays (the validator refuses it). */
function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
