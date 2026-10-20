import { IsBoolean, IsOptional } from "class-validator";

/** Issuing a ReefClub shop-link code (slice 5). */
export class IssueReefClubLinkCodeDto {
  /** Also send the code to the customer's registered e-mail address. */
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
