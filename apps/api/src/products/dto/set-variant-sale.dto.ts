import { IsISO8601, IsString, Matches } from "class-validator";

/**
 * A VÁLTOZAT SAJÁT AKCIÓS ÁRA (T4.1-D3, akciós ár 1. szelet). Az ár ugyanúgy
 * egész forint, mint a saját eladási ár (`SetVariantPriceDto`), mert ugyanaz a
 * felület mutatja.
 *
 * A KÉT IDŐPONT KÖTELEZŐ, időzónával (ISO 8601): a kezdet az első pillanat,
 * amikor már, a vég az első, amikor már NEM érvényes. Vég nélküli akció nincs,
 * mert az nem akció, hanem új ár (és az Omnibus-szabály az akcióhoz mér).
 */
export class SetVariantSaleDto {
  @IsString()
  @Matches(/^[1-9]\d{0,8}$/, {
    message: "Az akciós ár pozitív egész forint legyen (például 9990).",
  })
  grossPrice!: string;

  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: "A kezdet ISO 8601 időpont legyen, időzónával." },
  )
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, {
    message: "A kezdet időzónával együtt kell (Z vagy +01:00).",
  })
  startsAt!: string;

  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: "A vég ISO 8601 időpont legyen, időzónával." },
  )
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, {
    message: "A vég időzónával együtt kell (Z vagy +01:00).",
  })
  endsAt!: string;
}
