import {
  WEBSHOP_STALE_STATUSES,
  type WebshopStaleThreshold,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/** Egy státusz küszöbe. Legalább 1: a figyelést a kapcsoló kapcsolja ki, nem a nulla. */
export class WebshopStaleThresholdDto implements WebshopStaleThreshold {
  @IsIn([...WEBSHOP_STALE_STATUSES])
  status!: WebshopStaleThreshold["status"];

  @IsInt()
  @Min(1)
  @Max(10_000)
  value!: number;

  @IsIn(["HOUR", "DAY"])
  unit!: WebshopStaleThreshold["unit"];

  @IsBoolean()
  enabled!: boolean;
}

export class WebshopStaleThresholdsDto {
  @ValidateNested({ each: true })
  @Type(() => WebshopStaleThresholdDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBSHOP_STALE_STATUSES.length)
  thresholds!: WebshopStaleThresholdDto[];
}
