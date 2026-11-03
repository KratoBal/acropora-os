import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

/** Az attribútum-kulcsok alakja: kisbetű, szám, aláhúzás (a seed kulcsai ilyenek). */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{1,47}$/;

export class AttributeSetAttributeDto {
  @IsString() @Matches(ATTRIBUTE_KEY_PATTERN) attributeKey!: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() filterable?: boolean;
  @IsOptional() @IsString() @MaxLength(100) group?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

/** ÚJ készlet; meglévőt nem módosít és nem töröl (additív). */
export class CreateAttributeSetDto {
  @IsString() @Matches(ATTRIBUTE_KEY_PATTERN) key!: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  /** A szülő készlet kulcsa: az alkészlet örökli a szülő attribútumait. */
  @IsOptional() @IsString() @Matches(ATTRIBUTE_KEY_PATTERN) parentKey?: string;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttributeSetAttributeDto)
  attributes!: AttributeSetAttributeDto[];
}

/**
 * A termék készlete; a `null` leveszi a kötést. A kulcs KÖTELEZŐ (barracuda, #2100 review): egy
 * üres törzs vagy egy elgépelt kulcs (`attributeSetID`) nem lehet csendben a kötés levétele, mert egy
 * kliens-hiba így adatot törölne, és sikert jelezne. Levenni csak kifejezett `null`-lal lehet.
 */
export class SetProductAttributeSetDto {
  @IsDefined()
  @ValidateIf((o: SetProductAttributeSetDto) => o.attributeSetId !== null)
  @IsString()
  @MaxLength(100)
  attributeSetId!: string | null;
}
