import {
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The issue request: the draft's `updatedAt` as last loaded (the conflict guard), and what the confirmation window
 * showed and the person confirmed (card 7ba97e0d): the three dates and the digest of the shown values. The dates'
 * own rule (`checkBillingIssueDates`) runs in the service, where the payment method is known.
 */
export class BillingDocumentIssueDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @Matches(DAY)
  issueDate!: string;

  @Matches(DAY)
  fulfillmentDate!: string;

  /** Null for a document type with no payment fields, and ignored for a card payment (due on the issue date). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DAY)
  dueDate?: string | null;

  @IsString()
  @Length(64, 64)
  fingerprint!: string;
}
