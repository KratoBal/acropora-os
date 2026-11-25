import { BadRequestException } from "@nestjs/common";
import type { WebshopProformaAdvance } from "@acropora/types";
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

/**
 * AN ADVANCE PROFORMA (card d31a66a3, 2a): a percentage of the order's total OR an amount in forints, one of the two; neither is
 * the whole-order proforma, as before. The window's summary and the first send carry the same one. The text's own rule (a number,
 * under the total) is the rules' (`advanceAmountOf`), so the person reads the reason in Hungarian.
 */
export class WebshopProformaAdvanceDto {
  @IsOptional()
  @IsString()
  @Length(1, 12)
  advancePercent?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  advanceAmount?: string;
}

/** The advance the request names, if any; both at once is no request a page makes. */
export function proformaAdvanceOf(
  input: WebshopProformaAdvanceDto | undefined,
): WebshopProformaAdvance | undefined {
  const percent = input?.advancePercent;
  const amount = input?.advanceAmount;
  if (percent !== undefined && amount !== undefined)
    throw new BadRequestException(
      "Az előleget vagy százalékban, vagy összegben add meg, a kettőt együtt nem.",
    );
  if (percent !== undefined) return { percent };
  if (amount !== undefined) return { amount };
  return undefined;
}

/**
 * The proforma's send (card 7ba97e0d follow-up): the first send issues it, so it carries what the window showed (the
 * three dates and the digest, `POST :id/proforma/summary`); a resend makes no new document and sends none. The send is
 * the point of the button, so there is no `send` flag. The dates' own rule runs in the shared issuer.
 */
export class WebshopProformaSendDto extends WebshopProformaAdvanceDto {
  /**
   * The amount the window showed (`WebshopProformaSummary.grossAmount`): the first send of an advance proforma checks it against
   * the proforma it issues, since the window's digest covers the buyer and the dates, not the amount.
   */
  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,4})?$/)
  grossAmount?: string;

  @IsOptional()
  @Matches(DAY)
  issueDate?: string;

  @IsOptional()
  @Matches(DAY)
  fulfillmentDate?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DAY)
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  fingerprint?: string;
}
