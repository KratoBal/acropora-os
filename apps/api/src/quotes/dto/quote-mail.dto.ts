import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import type { QuoteSendInput } from "@acropora/types";

/** #1582 P3; the service checks the addresses and the rules. */
export class QuoteSendDto implements QuoteSendInput {
  @IsString() @MinLength(1) @MaxLength(100) requestId!: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) to!: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  cc?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  bcc?: string[];
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(10_000) body!: string;
}
