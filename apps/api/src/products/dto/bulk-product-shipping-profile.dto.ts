import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

import {
  SHIPPING_FLAGS,
  type ShippingFlag,
} from "../shipping-profile-sources.js";

/** A beállítandó jelzők; a megnevezett jelző kézi lesz. */
export class ShippingFlagsSetDto {
  @IsOptional() @IsBoolean() pickupOnly?: boolean;
  @IsOptional() @IsBoolean() foxpostForbidden?: boolean;
  @IsOptional() @IsBoolean() isHeavy?: boolean;
  @IsOptional() @IsBoolean() isFrozen?: boolean;
  @IsOptional() @IsBoolean() lockerUnsuitable?: boolean;
}

/** A tömeges szerkesztés (a82ed229): legfeljebb 500 termék egy kérésben. */
export class BulkProductShippingProfileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  productIds!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingFlagsSetDto)
  set?: ShippingFlagsSetDto;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SHIPPING_FLAGS, { each: true })
  resetToUnas?: ShippingFlag[];
}
