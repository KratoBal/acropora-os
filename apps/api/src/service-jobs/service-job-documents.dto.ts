import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

import { DOCUMENT_CAPTION_MAX_LENGTH } from "../documents/document-caption.js";

/**
 * HANY FAJL MEHET EGY KERESBEN.
 *
 * UGYANAZ A SZAM, MINT AZ ESZKOZNEL ES A MUNKALAPNAL (tiz), es szandekosan: a
 * harom felulet UGYANAZT a kotetet es UGYANAZT a keretet hasznalja, tehat egy
 * kulonbozo hatar csak azt jelentene, hogy az egyiket elfelejtettuk
 * karbantartani.
 */

const SERVICE_JOB_DOCUMENT_TYPES = ["PHOTO", "OTHER"] as const;

export class UploadServiceJobDocumentDto {
  /**
   * A CSATOLMANY FAJTAJA. ELHAGYHATO, es az alapertelmezes a `PHOTO`.
   *
   * Balazs kerese KET dolgot mond ("fotot illetve egyeb fajlokat is"), es a
   * ketto NEM egyenrangu: a bejelento tipikusan fenykepet tesz fel, az "egyeb"
   * a ritkabb eset. Egy kotelezo mezo itt a gyakori uton csak egy allando
   * literal lenne a kliensben.
   */
  @IsIn(SERVICE_JOB_DOCUMENT_TYPES)
  @IsOptional()
  type?: (typeof SERVICE_JOB_DOCUMENT_TYPES)[number];

  /**
   * A FELIRAT MAR A FELTOLTESKOR MEGADHATO (Balazs kerese, 2026-09-17:
   * „akar mar a feltoltesnel is").
   *
   * EGY KERESRE EGY FELIRAT, ES EZ KI VAN MONDVA, NEM ELREJTVE. A vegpont
   * egyszerre tiz fajlt fogad, es ez az egy szoveg MINDEGYIKRE rakerul --
   * tipikusan egy helyszinen, egy percen belul keszult sorozatrol van szo. Aki
   * kepenkent mast akar irni, a szerkeszto uton teszi (`PATCH`), vagy egyesevel
   * tolt fel. A tomb-alaku, fajlonkenti felirat SZANDEKOSAN nem szerepel itt:
   * a multipart mezok sorrendje nem garantalja az igazitast a fajlokhoz, es egy
   * elcsuszott felirat NEM hibazna -- csak rossz kepre kerulne.
   */
  @IsString()
  @MaxLength(DOCUMENT_CAPTION_MAX_LENGTH)
  @IsOptional()
  caption?: string;
}

/**
 * A FELIRAT UTOLAGOS ATIRASA.
 *
 * A `null` ITT ERVENYES ERTEK, es ez nem elnezes: a felirat TORLESE ugyanezen
 * az uton megy. Egy `@IsOptional()` a `null`-t is kihagyna az ellenorzesbol, de
 * a MEZO ELHAGYASA es a `null` KULDESE ket kulonbozo szandek -- az elso "ne
 * nyulj hozza", a masodik "toroljem". Ez a vegpont EGY mezot ir, tehat a
 * megkulonboztetes itt nem kell: a hianyzo mezo is torlest jelent, es ezt a
 * `ValidateIf` mondja ki -- a szoveg-ellenorzes csak akkor fut, ha van szoveg.
 */
export class UpdateServiceJobDocumentCaptionDto {
  @ValidateIf((_, ertek) => ertek !== null && ertek !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_CAPTION_MAX_LENGTH)
  caption?: string | null;
}
