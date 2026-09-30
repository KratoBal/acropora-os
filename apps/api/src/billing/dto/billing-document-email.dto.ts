import {
  BILLING_EMAIL_MODES,
  type BillingDocumentEmailInput,
  type BillingEmailMode,
} from "@acropora/types";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

/** `POST /billing/documents/:id/email`; the shape is `BillingDocumentEmailInput`. */
export class BillingDocumentEmailDto implements BillingDocumentEmailInput {
  @IsUUID() requestId!: string;
  @IsIn(BILLING_EMAIL_MODES) mode!: BillingEmailMode;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) to!: string[];
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) cc!: string[];
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) bcc!: string[];
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(20000) body!: string;
}
