import { IsOptional, Matches } from "class-validator";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Budapest calendar days, inclusive; both default to today. */
export class PosPaymentSummaryQueryDto {
  @IsOptional()
  @Matches(DAY, { message: "from must be YYYY-MM-DD" })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: "to must be YYYY-MM-DD" })
  to?: string;
}
