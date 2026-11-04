import { IsString, Matches } from "class-validator";

/**
 * A változat saját bruttó eladási ára (T4.1-D3, 2. szelet). Szövegként jön,
 * mert pénz: a lebegőpontos szám már a JSON-ban kerekíthetne.
 *
 * EGÉSZ FORINT, legfeljebb kilenc jegy, és nem nulla. A bolt forintban áraz, és a
 * felület egész forintot mutat (`formatMoney`): egy 12990.50-es ár 12 991 Ft-nak
 * látszott volna, miközben 12990.50 menne a boltba (barracuda, #2130). A nulla
 * nem árazás, hanem elírás; a nulla saját árat a vetítés amúgy is hiányként
 * kezelné.
 */
export class SetVariantPriceDto {
  @IsString()
  @Matches(/^[1-9]\d{0,8}$/, {
    message: "Az ár pozitív egész forint legyen (például 12990).",
  })
  grossPrice!: string;
}
