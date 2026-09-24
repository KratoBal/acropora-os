import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import { CreateCustomerDto } from "../../customers/dto/customer.dto.js";

const OWNERSHIP_TYPES = ["OWN", "CUSTOMER"] as const;
const WATER_BODY_TYPES = ["AKVARIUM", "TO"] as const;
const WATER_TYPES = ["EDESVIZI", "TENGERI"] as const;
/** Balázs listája (2026-09-24), lásd a `AquariumEquipmentKind` séma-fejlécét. */
const EQUIPMENT_KINDS = [
  "VILAGITAS",
  "ARAMOLTATAS",
  "LEHABZO",
  "FELNYOMO",
  "BIO_SZURES",
  "MEDIA_REAKTOR",
  "NYOMELEM_ADAGOLO",
  "FUTES",
  "HUTES",
  "EGYEB",
] as const;

export class CreateAquariumEquipmentDto {
  @IsIn(EQUIPMENT_KINDS) kind!: (typeof EQUIPMENT_KINDS)[number];
  @IsString() @IsOptional() manufacturer?: string;
  @IsString() @IsOptional() model?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() quantity: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() channelCount?: number;
  @IsString() @IsOptional() notes?: string;
}

/**
 * AZ ÚJ ÜGYFÉL A MEGLÉVŐ `Customer` TÁBLÁBA KERÜL, NEM SZABAD SZÖVEGKÉNT.
 *
 * Balázs döntése szerint (acrobot brief-je, 2026-09-24): a lapon kereshető,
 * meglévő ügyfél, VAGY ugyanitt felvehető új -- ez utóbbi a MEGLÉVŐ
 * `CreateCustomerDto`-t veszi át, változatlanul, hogy a két felvitel ne
 * eshessen szét két külön validációra.
 */
export class CreateAquariumDto {
  /**
   * A KLIENS ÁLTAL ADOTT MŰVELET-AZONOSÍTÓ, A HELYSZÍNI RÖGZÍTÉS
   * IDEMPOTENCIA-KULCSA.
   *
   * ELHAGYHATÓ, ÉS EZ KIKÖTÉS: a webes felvitel nem küld kulcsot, és MA
   * MŰKÖDIK. Kötelezővé téve az űrlapot is át kellene írni.
   *
   * UGYANAZ AZ ALAK, MINT A MUNKALAPNÁL (`CreateWorksheetDto`) és a
   * hibajegynél (`CreateServiceJobDto`) -- lásd `aquariums.repository.ts`
   * `create()`-jét a védelemért.
   */
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.",
  })
  @IsOptional()
  clientOperationId?: string;
  @IsIn(OWNERSHIP_TYPES) ownershipType!: (typeof OWNERSHIP_TYPES)[number];
  @IsString() @IsOptional() customerId?: string;
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  @IsOptional()
  newCustomer?: CreateCustomerDto;

  @IsString() @MinLength(1) name!: string;
  @IsIn(WATER_BODY_TYPES)
  @IsOptional()
  waterBodyType: (typeof WATER_BODY_TYPES)[number] = "AKVARIUM";

  @Type(() => Number) @IsOptional() lengthCm?: number;
  @Type(() => Number) @IsOptional() widthCm?: number;
  @Type(() => Number) @IsOptional() heightCm?: number;
  @Type(() => Number) @IsOptional() systemVolumeLiters?: number;
  /** Lásd `aquarium-volume.ts` fejlécét: a kliens jelzi, EBBEN a mentésben
   * a felhasználó írta-e át a litert. */
  @IsBoolean() @IsOptional() systemVolumeIsManual: boolean = false;

  @IsIn(WATER_TYPES) @IsOptional() waterType?: (typeof WATER_TYPES)[number];
  @IsDateString() @IsOptional() startedAt?: string;
  @IsString() @IsOptional() notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAquariumEquipmentDto)
  @IsOptional()
  equipment: CreateAquariumEquipmentDto[] = [];
}

export class UpdateAquariumDto {
  @IsIn(OWNERSHIP_TYPES)
  @IsOptional()
  ownershipType?: (typeof OWNERSHIP_TYPES)[number];
  @IsString() @IsOptional() customerId?: string | null;
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  @IsOptional()
  newCustomer?: CreateCustomerDto;

  @IsString() @MinLength(1) @IsOptional() name?: string;
  @IsIn(WATER_BODY_TYPES)
  @IsOptional()
  waterBodyType?: (typeof WATER_BODY_TYPES)[number];

  @Type(() => Number) @IsOptional() lengthCm?: number | null;
  @Type(() => Number) @IsOptional() widthCm?: number | null;
  @Type(() => Number) @IsOptional() heightCm?: number | null;
  @Type(() => Number) @IsOptional() systemVolumeLiters?: number | null;
  @IsBoolean() @IsOptional() systemVolumeIsManual?: boolean;

  @IsIn(WATER_TYPES) @IsOptional() waterType?:
    (typeof WATER_TYPES)[number] | null;
  @IsDateString() @IsOptional() startedAt?: string | null;
  @IsString() @IsOptional() notes?: string | null;
  @IsBoolean() @IsOptional() isActive?: boolean;

  @IsString() expectedUpdatedAt!: string;
}

export class AquariumListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(OWNERSHIP_TYPES)
  @IsOptional()
  ownershipType?: (typeof OWNERSHIP_TYPES)[number];
}
