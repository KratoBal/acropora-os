import { IsDateString, IsString, MaxLength } from "class-validator";

/** A vázlat mentése (2b3983e1): a szöveg és az optimista zár. */
export class UpdateMeasurementRecommendationDto {
  @IsString()
  @MaxLength(10_000)
  text!: string;

  @IsDateString()
  expectedUpdatedAt!: string;
}

export class ApproveMeasurementRecommendationDto {
  @IsDateString()
  expectedUpdatedAt!: string;
}
