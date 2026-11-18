import { ValidateIf } from "class-validator";

/**
 * EGY OPCIONÁLIS MEZŐ, AMELY NEM LEHET NULL (task t-20261118-null-oro). A class-validator `@IsOptional()` a `null`-t ÉS az `undefined`-ot is átengedi, tehát egy
 * `flag?: boolean` mezőn az explicit `{ "flag": null }` átjut a validáción, és egy nem-null Prisma-oszlopra írva 500 lesz a 400 helyett (a #2675-ön a
 * tesztem fogta meg, mielőtt kiment). Ez a dekorátor csak a HIÁNYZÓ (`undefined`) mezőt hagyja ki: a `null` érték a mező TÍPUS-ellenőrzőjére
 * (`@IsBoolean()`, `@IsString()`, ...) kerül, és ott elbukik, tehát 400.
 *
 * HASZNÁLAT: mindig egy típus-ellenőrzővel együtt (`@IsOptionalNotNull() @IsBoolean() flag?: boolean;`): enélkül a null nem lenne mivel összevetve.
 * Ahol a null ÉRTÉK (a mező törlése), a mező típusa legyen `T | null`, és `@IsOptional()` marad.
 */
export function IsOptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object, value) => value !== undefined);
}
