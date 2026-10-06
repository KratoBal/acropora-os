import {
  EXPECTED_ARRIVAL_LIST_PAGE_SIZE,
  type ExpectedArrivalListQuery,
  type ExpectedArrivalSource,
} from "@acropora/types";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/**
 * `GET /purchasing/expected-arrivals` (kártya dd0aef31). ALAPÉRTÉK NINCS: ha egyik
 * lapozó mező sincs megadva, a válasz a teljes lista, mint eddig.
 */
export class ExpectedArrivalListQueryDto implements ExpectedArrivalListQuery {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPECTED_ARRIVAL_LIST_PAGE_SIZE.max)
  @IsOptional()
  pageSize?: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPECTED_ARRIVAL_LIST_PAGE_SIZE.max)
  @IsOptional()
  limit?: number;
  @IsIn(["MAIL", "NAV"] satisfies ExpectedArrivalSource[])
  @IsOptional()
  source?: ExpectedArrivalSource;
  @IsString() @IsOptional() q?: string;
}
