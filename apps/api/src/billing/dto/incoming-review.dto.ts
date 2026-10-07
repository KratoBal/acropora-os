import type { IncomingReviewInput } from "@acropora/types";
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

/** Tizedes szöveg, legfeljebb két tizedessel (a tábla Decimal(18, 2)). */
const AMOUNT = /^-?\d{1,16}([.,]\d{1,2})?$/;
/** Naptári nap; az érvényességet a Date-ra fordítás előtt ez szűri. */
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * A postafiókos számla javított mezői (kártya e4c3b0fb). Minden mező
 * elhagyható vagy `null`: a mentés hiányos adattal is megy, a jóváhagyás
 * nem (azt a szolgáltatás nézi, magyar üzenettel).
 */
export class IncomingReviewDto implements IncomingReviewInput {
  @IsOptional() @IsString() @MaxLength(255) supplierName!: string | null;
  @IsOptional() @IsString() @MaxLength(32) supplierTaxNumber!: string | null;
  @IsOptional() @IsString() @MaxLength(32) supplierEuTaxNumber!: string | null;
  @IsOptional() @IsString() @MaxLength(100) documentNumber!: string | null;
  @IsOptional() @IsString() @Matches(DAY) issueDate!: string | null;
  @IsOptional() @IsString() @Matches(DAY) fulfillmentDate!: string | null;
  @IsOptional() @IsString() @Matches(DAY) dueDate!: string | null;
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string | null;
  @IsOptional() @IsString() @Matches(AMOUNT) netAmount!: string | null;
  @IsOptional() @IsString() @Matches(AMOUNT) vatAmount!: string | null;
  @IsOptional() @IsString() @Matches(AMOUNT) grossAmount!: string | null;
}
