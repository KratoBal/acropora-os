import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class NavIncomingInvoiceListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
  @IsIn(["NEW", "DATA_FETCHED", "RECEIVED", "ERROR"])
  @IsOptional()
  status?: "NEW" | "DATA_FETCHED" | "RECEIVED" | "ERROR";
}
