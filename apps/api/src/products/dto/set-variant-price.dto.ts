import { IsString, Matches } from "class-validator";

/**
 * A változat saját bruttó eladási ára (T4.1-D3, 2. szelet). Szövegként jön,
 * mert pénz: a lebegőpontos szám már a JSON-ban kerekíthetne. Legfeljebb kilenc
 * egész és két tizedesjegy, pont tizedesjellel, és nem nulla (egy 0 Ft-os ár
 * nem árazás, hanem elírás; a nulla saját árat a vetítés amúgy is hiányként
 * kezelné).
 */
export class SetVariantPriceDto {
  @IsString()
  @Matches(/^(?!0+(\.0+)?$)\d{1,9}(\.\d{1,2})?$/, {
    message:
      "Az ár pozitív szám legyen, legfeljebb két tizedesjeggyel, pont tizedesjellel.",
  })
  grossPrice!: string;
}
