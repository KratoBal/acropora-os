import { IsOptional, IsString, MaxLength } from "class-validator";

/** The storno request: an optional reason, sent to Számlázz.hu as `megjegyzes`. */
export class BillingDocumentStornoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
