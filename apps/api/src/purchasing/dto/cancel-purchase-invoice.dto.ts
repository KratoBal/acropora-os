import { IsString, MaxLength } from "class-validator";
import type { CancelPurchaseInvoiceInput } from "@acropora/types";

/** The shape; the conditions (unpaid, nothing consumed, stock still there) are the service's. */
export class CancelPurchaseInvoiceDto implements CancelPurchaseInvoiceInput {
  @IsString() @MaxLength(500) reason!: string;
}
