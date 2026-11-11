import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The order's invoice issue (card 7ba97e0d, S2): what the confirmation window showed and the person confirmed, the
 * three dates and the digest of the shown values (`POST :id/invoice/summary` gives them), and "Elküldöm e-mailben".
 * The dates' own rule (`checkBillingIssueDates`) runs in the shared issuer, where the payment method is known.
 */
export class WebshopOrderInvoiceIssueDto {
  @Matches(DAY)
  issueDate!: string;

  @Matches(DAY)
  fulfillmentDate!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DAY)
  dueDate?: string | null;

  @IsString()
  @Length(64, 64)
  fingerprint!: string;

  @IsBoolean()
  send!: boolean;
}
