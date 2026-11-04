import { IsOptional, IsString, Length, MaxLength } from "class-validator";

/** `POST /admin/partner-merges/preview`: a két vevő-sor azonosítója. */
export class PartnerMergePreviewDto {
  /** a MEGMARADÓ sor */
  @IsString() @Length(1, 64) keptId!: string;
  /** a MEGSZŰNŐ sor (archiválódik) */
  @IsString() @Length(1, 64) mergedId!: string;
}

/** `POST /admin/partner-merges/execute`: ugyanaz, az előnézet lenyomatával és egy indoklással. */
export class PartnerMergeExecuteDto extends PartnerMergePreviewDto {
  @IsString() @Length(64, 64) fingerprint!: string;
  @IsString() @MaxLength(500) @IsOptional() reason?: string;
}
