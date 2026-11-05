import {
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * „KÉZZEL RENDEZVE” (6fd8c574): a napi jelölés egy figyelmet kérő sora, a forrással, a tétel kulcsával és okával, ahogy a
 * `latest` adja. `closed`: true a lezárás, false a visszavonás.
 */
export class AttentionClosureDto {
  @IsIn(["GLS_COD", "FOXPOST", "SIMPLEPAY", "BANK_TRANSFER"])
  source!: "GLS_COD" | "FOXPOST" | "SIMPLEPAY" | "BANK_TRANSFER";

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  reason!: string;

  @IsBoolean()
  closed!: boolean;
}
