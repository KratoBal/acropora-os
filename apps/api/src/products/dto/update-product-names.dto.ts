import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * A NEVEK KOZVETLEN IRASA (kartya 20b0dd47, `PATCH /products/:id/names`): a magyar, az angol es a nemet nev az adatlapon.
 * Ugyanazok a szabalyok, mint az `UpdateProductDto` nev-mezoin: a szoveg a szokozok nelkul megy tovabb, legfeljebb 200
 * karakter, az ures szoveg vagy a `null` torli a nevet, nem szoveg 400. KULON DTO es kulon vegpont, mert a nevek Acropora-
 * tulajdonuak (a UNAS-szinkron nem irja oket), es egy UNAS-gazdaju termeken is irhatonak kell lenniuk, mikozben a termek
 * tobbi mezoje ott 409 marad (`PRODUCT_MANAGED_BY_UNAS`).
 */
export class UpdateProductNamesDto {
  @IsOptional()
  @Transform(trimmedName)
  @IsString()
  @MaxLength(200)
  magyarNev?: string | null;

  @IsOptional()
  @Transform(trimmedName)
  @IsString()
  @MaxLength(200)
  angolNev?: string | null;

  @IsOptional()
  @Transform(trimmedName)
  @IsString()
  @MaxLength(200)
  nemetNev?: string | null;
}

/** A szoveg a szokozok nelkul; ami nem szoveg, valtozatlan (a validator utasitja el). */
function trimmedName({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
