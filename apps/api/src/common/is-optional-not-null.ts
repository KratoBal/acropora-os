import { applyDecorators } from "@nestjs/common";
import { NotEquals, ValidateIf } from "class-validator";

/**
 * EGY OPCIONÁLIS MEZŐ, AMELY NEM LEHET NULL (task t-20261118-null-oro). A class-validator `@IsOptional()` a `null`-t ÉS az `undefined`-ot is átengedi, tehát egy
 * `flag?: boolean` mezőn az explicit `{ "flag": null }` átjut a validáción, és egy nem-null Prisma-oszlopra írva 500 lesz a 400 helyett (a #2675-ön a
 * tesztem fogta meg, mielőtt kiment). Ez a dekorátor csak a HIÁNYZÓ (`undefined`) mezőt hagyja ki: a `null` érték a mező TÍPUS-ellenőrzőjére
 * (`@IsBoolean()`, `@IsString()`, ...) kerül, és ott elbukik, tehát 400.
 *
 * A null MAGA 400 (egy `NotEquals(null)` is rajta van), tehát egyedül kitéve is zár; a rossz TÍPUST továbbra is a mező típus-ellenőrzője fogja
 * (`@IsOptionalNotNull() @IsBoolean() flag?: boolean;`).
 * Ahol a null ÉRTÉK (a mező törlése), a mező típusa legyen `T | null`, és `@IsOptional()` marad.
 */
export function IsOptionalNotNull(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object, value) => value !== undefined),
    // a null MAGA is 400, a típus-ellenőrzőtől függetlenül (barracuda, #2678): a használat módja nem dönti el, átmegy-e
    NotEquals(null, { message: "$property must not be null" }),
  );
}
