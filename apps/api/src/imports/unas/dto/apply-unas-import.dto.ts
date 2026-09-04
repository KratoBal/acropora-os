import { IsBoolean, IsOptional } from "class-validator";

export class ApplyUnasImportDto {
  /**
   * KERI-E A HIVO A KAPCSOLATOK IRASAT. Alapertelmezesben NEM.
   *
   * A munkafuzet a kapcsolatokra nezve MERVADO: amit nem sorol fel, azt torli.
   * Egy reszleges tablazat (ar, keszlet) tehat csendben elvinne a hasonlo- es
   * kiegeszito-termek kapcsolatokat. A ket tevedes ara nem egyforma: az elmaradt
   * iras HANGOS (a feltolto latja, hogy nem valtozott), a veletlen torles NEMA.
   *
   * A mezo hianya `false`-ot jelent, nem hibat: a meglevo hivok viselkedese igy
   * VALTOZIK -- ezt szandekosan tesszuk, es a PR torzse mondja meg, miert.
   */
  @IsBoolean()
  @IsOptional()
  writeRelations?: boolean;
}
