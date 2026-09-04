import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * A TELJES OSSZEVETES KERESE, ES MIERT `false` AZ ALAPERTELMEZES.
 *
 * A mai viselkedes az inkrementalis futas, es ez a DTO nem valtoztat rajta: a
 * mezo hianyaban `false` marad. Teljes osszevetes CSAK akkor indul, ha a hivo
 * kifejezetten azt keri.
 *
 * A `Transform` azert kell, mert a query mindig SZOVEG: a `?full=true` alakbol
 * `"true"` erkezik, es egy `Boolean("false")` igazat adna -- vagyis a kikapcsolt
 * allapot csendben bekapcsoltta valna.
 */
export class UnasProductSyncQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  full = false;
}
