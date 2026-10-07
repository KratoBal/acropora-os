import {
  BILLING_DOCUMENT_LIST_PAGE_SIZE,
  INCOMING_BANK_MATCH_STATES,
  INCOMING_PAYMENT_STATES,
  INCOMING_REVIEW_STATES,
  type IncomingBankMatchState,
  type IncomingDateBasis,
  type IncomingDocumentListQuery,
  type IncomingPaymentState,
  type IncomingReviewState,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /billing/incoming-documents` query; the shape is `IncomingDocumentListQuery`. */
export class IncomingDocumentListQueryDto implements IncomingDocumentListQuery {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BILLING_DOCUMENT_LIST_PAGE_SIZE.max)
  @IsOptional()
  pageSize: number = BILLING_DOCUMENT_LIST_PAGE_SIZE.default;
  @IsString() @IsOptional() q?: string;
  @Matches(DAY) @IsOptional() from?: string;
  @Matches(DAY) @IsOptional() to?: string;
  @IsIn(["ISSUE", "FULFILLMENT"]) @IsOptional() dateBasis?: IncomingDateBasis;
  @IsIn(INCOMING_PAYMENT_STATES)
  @IsOptional()
  paymentState?: IncomingPaymentState;
  @IsString() @IsOptional() kindCode?: string;
  @IsString() @IsOptional() currency?: string;
  @IsIn(INCOMING_BANK_MATCH_STATES)
  @IsOptional()
  bankMatch?: IncomingBankMatchState;
  @IsIn(INCOMING_REVIEW_STATES)
  @IsOptional()
  review?: IncomingReviewState;
}
