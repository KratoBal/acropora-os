import { IsOptional, IsString, MaxLength } from "class-validator";

export class PosProductSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
