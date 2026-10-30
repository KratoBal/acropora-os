import {
  MISSING_INVOICE_CATEGORIES,
  type MissingInvoiceCategory,
  type MissingInvoiceCategoryInput,
  type MissingInvoiceCommentInput,
  type MissingInvoiceDuplicateInput,
  type MissingInvoiceMatchInput,
  type MissingInvoicePaperOriginalInput,
  type MissingInvoicePayeeInput,
} from "@acropora/types";
import {
  IsBoolean,
  IsIn,
  IsOptional,
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

export class MissingInvoiceDuplicateDto implements MissingInvoiceDuplicateInput {
  @IsBoolean() marked!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  duplicateOfId?: string | null;
}

export class MissingInvoicePayeeDto implements MissingInvoicePayeeInput {
  @IsIn(["COMPANY", "NOT_COMPANY"])
  payee!: "COMPANY" | "NOT_COMPANY";
}

/** A feltöltés fajtája: számla vagy biztosítási díjértesítő (acrobot 25265 c). */
export class MissingInvoiceUploadDto {
  @IsIn(["INVOICE", "PREMIUM_NOTICE"])
  kind!: "INVOICE" | "PREMIUM_NOTICE";
}
