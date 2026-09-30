import {
  MISSING_INVOICE_CATEGORIES,
  type MissingInvoiceCategory,
  type MissingInvoiceCategoryInput,
  type MissingInvoiceCommentInput,
  type MissingInvoiceMatchInput,
  type MissingInvoicePaperOriginalInput,
} from "@acropora/types";
import {
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

export class MissingInvoiceMatchDto implements MissingInvoiceMatchInput {
  @IsString() @MinLength(1) documentId!: string;
}

export class MissingInvoiceCommentDto implements MissingInvoiceCommentInput {
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  comment!: string | null;
}

export class MissingInvoiceCategoryDto implements MissingInvoiceCategoryInput {
  @ValidateIf((_o, value) => value !== null)
  @IsIn(MISSING_INVOICE_CATEGORIES)
  category!: MissingInvoiceCategory | null;
}

export class MissingInvoicePaperOriginalDto implements MissingInvoicePaperOriginalInput {
  @IsBoolean() marked!: boolean;
}

/** A feltöltés fajtája: számla vagy biztosítási díjértesítő (acrobot 25265 c). */
export class MissingInvoiceUploadDto {
  @IsIn(["INVOICE", "PREMIUM_NOTICE"])
  kind!: "INVOICE" | "PREMIUM_NOTICE";
}
