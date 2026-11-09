import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

/** Csak a megadott jelzők változnak; a többi marad, ahogy a terméken áll (a82ed229, 2c). */
export class ShippingFlagChangesDto {
  @IsOptional() @IsBoolean() pickupOnly?: boolean;
  @IsOptional() @IsBoolean() foxpostForbidden?: boolean;
  @IsOptional() @IsBoolean() isHeavy?: boolean;
  @IsOptional() @IsBoolean() isFrozen?: boolean;
  @IsOptional() @IsBoolean() lockerUnsuitable?: boolean;
}

/** Egy lap kijelöltjei: legfeljebb 500 termék egy hívásban. */
export class BulkProductShippingProfileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  productIds!: string[];

  @ValidateNested()
  @Type(() => ShippingFlagChangesDto)
  changes!: ShippingFlagChangesDto;
}
