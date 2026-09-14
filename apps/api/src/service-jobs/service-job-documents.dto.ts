import { IsIn, IsOptional } from "class-validator";

/**
 * HANY FAJL MEHET EGY KERESBEN.
 *
 * UGYANAZ A SZAM, MINT AZ ESZKOZNEL ES A MUNKALAPNAL (tiz), es szandekosan: a
 * harom felulet UGYANAZT a kotetet es UGYANAZT a keretet hasznalja, tehat egy
 * kulonbozo hatar csak azt jelentene, hogy az egyiket elfelejtettuk
 * karbantartani.
 */
export const MAX_SERVICE_JOB_DOCUMENTS_PER_UPLOAD = 10;

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
}
