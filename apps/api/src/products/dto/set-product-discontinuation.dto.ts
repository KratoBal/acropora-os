import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * THE WHOLE STATE OF THE MARK, NOT A PATCH. A missing or `null` replacement means "no replacement": the
 * `@IsOptional` lets `null` through ON PURPOSE here (it is the value, not a gap). A person who saves the mark
 * again without picking a product has cleared the replacement, and the shop then sends the visitor to the
 * category; leaving the old replacement silently in place would be the surprise.
 */
export class SetProductDiscontinuationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  replacementProductId?: string | null;
}
