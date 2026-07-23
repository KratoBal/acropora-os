import { IsISO8601, IsString, MinLength } from "class-validator";

export class ExchangeRateQueryDto {
  @IsString() @MinLength(3) currency!: string;
  @IsISO8601() date!: string;
}
