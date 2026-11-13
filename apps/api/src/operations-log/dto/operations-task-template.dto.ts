import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  OPERATIONS_FIELD_TYPES,
  OPERATIONS_METER_ROLES,
  OPERATIONS_TASK_FREQUENCIES,
  OPERATIONS_TEMPLATE_LIMITS,
  type OperationsMeterRole,
  type OperationsTaskFieldType,
  type OperationsTaskFrequency,
} from "@acropora/types";

/**
 * A BEMENET FORMAI ELLENŐRZÉSE ITT ÁLL, A SZABÁLYOK (szám-kötött mező, egy előtte és egy utána, kulcs-kiosztás) A KÖZÖS
 * `@acropora/types` FÜGGVÉNYEIBEN, a szolgáltatás futtatja őket: ugyanazt a mondatot kapja a szerkesztő és a szerver.
 */
const L = OPERATIONS_TEMPLATE_LIMITS;

export class OperationsTaskTemplateListQueryDto {
  /** A kivezetett sablonok csak kérésre jönnek: a rögzítés kínálata az aktívak. */
  @Type(() => Boolean) @IsBoolean() @IsOptional() includeInactive?: boolean;
}

export class OperationsTaskFieldDto {
  /** A meglévő mező kulcsa; az új mező nem küld kulcsot. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(L.keyMax)
  key?: string | null;

  @IsString()
  @MinLength(1, { message: "A mező címkéjét meg kell adni." })
  @MaxLength(L.labelMax, {
    message: `A mező címkéje legfeljebb ${L.labelMax} karakter lehet.`,
  })
  label!: string;

  @IsIn(OPERATIONS_FIELD_TYPES) type!: OperationsTaskFieldType;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(L.unitMax, {
    message: `A mértékegység legfeljebb ${L.unitMax} karakter lehet.`,
  })
  unit?: string | null;

  @IsBoolean() @IsOptional() required?: boolean;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsIn(OPERATIONS_METER_ROLES)
  meterRole?: OperationsMeterRole | null;
}

class OperationsTaskTemplateBodyDto {
  @IsString()
  @MinLength(1, { message: "A sablon nevét meg kell adni." })
  @MaxLength(L.nameMax, {
    message: `A sablon neve legfeljebb ${L.nameMax} karakter lehet.`,
  })
  name!: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(L.descriptionMax, {
    message: `A leírás legfeljebb ${L.descriptionMax} karakter lehet.`,
  })
  description?: string | null;

  @IsIn(OPERATIONS_TASK_FREQUENCIES) frequency!: OperationsTaskFrequency;

  /** A sablon pontosan egy célra szól: ezek közül PONTOSAN az egyik (a szolgáltatás ellenőrzi). */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  assetId?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  assetCategoryId?: string | null;

  /**
   * A TELJES MEZŐKÉSZLET, a megadott sorrendben: ami nincs benne, kikerül a sablonból. A felső határ a szolgáltatás szabályával
   * egyezik; itt csak a kérés mérete védett.
   */
  @IsArray()
  @ArrayMaxSize(L.fieldsMax + 20)
  @ValidateNested({ each: true })
  @Type(() => OperationsTaskFieldDto)
  fields!: OperationsTaskFieldDto[];
}

export class CreateOperationsTaskTemplateDto extends OperationsTaskTemplateBodyDto {}

export class UpdateOperationsTaskTemplateDto extends OperationsTaskTemplateBodyDto {
  /** Az egyidejűség-őr: a betöltött sablon `updatedAt`-je (ISO); eltérésnél a szerver 409-et ad. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsISO8601()
  expectedUpdatedAt?: string | null;

  /** A kivezetés ezen a mezőn megy (a `DELETE` is ezt állítja át); a visszaállítás is. */
  @IsBoolean() @IsOptional() isActive?: boolean;
}
