import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { BILLING_ISSUING_ACTIONS } from "@acropora/types";

/**
 * The resolve request: the check's proposal, confirmed. The server runs the
 * lookup again and only writes if it proposes exactly this (the client's word
 * is never the evidence).
 */
export class BillingIssuingResolveDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @IsIn(BILLING_ISSUING_ACTIONS.filter((action) => action !== "NONE"))
  action!: "RECORD_ISSUED" | "BACK_TO_DRAFT";

  /** Required with RECORD_ISSUED, null with BACK_TO_DRAFT. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  invoiceNumber!: string | null;
}
