import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

import {
  OBSERVE_DEFAULT_LIMIT,
  OBSERVE_MAX_LIMIT,
} from "../parcel-status-codes.js";

export class ParcelStatusCodesObserveQueryDto {
  @IsIn(["foxpost", "gls"])
  carrier!: "foxpost" | "gls";

  /** how many of the newest settled parcels to ask about; each is one tracking call */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OBSERVE_MAX_LIMIT)
  @IsOptional()
  limit: number = OBSERVE_DEFAULT_LIMIT;
}
