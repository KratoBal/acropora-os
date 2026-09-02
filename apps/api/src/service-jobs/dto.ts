import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * A hibajegy felvitele.
 *
 * A CÍM AZ EGYETLEN KÖTELEZŐ MEZŐ, és ez tudatos: egy jegy attól jegy, hogy
 * megnevezi, mi a baj. A vevő elhagyható, mert a jegyet mi is nyithatjuk
 * olyasmire, ami még nem kötődik ügyfélhez.
 */
export class CreateServiceJobDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsString() @MaxLength(4000) @IsOptional() description?: string | null;
  @IsString() @IsOptional() customerId?: string | null;
}

export const SERVICE_JOB_LIST_SCOPES = ["open", "all"] as const;

/**
 * A lista alapból csak a NYITOTT jegyeket adja.
 *
 * Nem kényelem: egy hibajegy-lista, ami a lezártakat is hozza, az első
 * hónap után használhatatlan - a napi munkában az számít, ami MÉG nyitva van.
 * A teljes lista külön kérésre jön.
 */
export class ServiceJobListQueryDto {
  @IsIn(SERVICE_JOB_LIST_SCOPES)
  @IsOptional()
  scope?: (typeof SERVICE_JOB_LIST_SCOPES)[number];
}

/**
 * Egy lépés a hibajegyen.
 *
 * A `note` elhagyható, de a felület kérheti: hogy egy jegy MIÉRT vár
 * alkatrészre, azt csak az tudja, aki odalépteti - és két hét múlva már senki.
 */
export class MoveServiceJobDto {
  @IsIn([
    "NEW",
    "TRIAGED",
    "SCHEDULED",
    "IN_PROGRESS",
    "WAITING_FOR_PARTS",
    "WAITING_FOR_CUSTOMER",
    "COMPLETED",
    "CANCELLED",
  ])
  to!:
    | "NEW"
    | "TRIAGED"
    | "SCHEDULED"
    | "IN_PROGRESS"
    | "WAITING_FOR_PARTS"
    | "WAITING_FOR_CUSTOMER"
    | "COMPLETED"
    | "CANCELLED";

  @IsString() @MaxLength(2000) @IsOptional() note?: string | null;
}

/**
 * Egy meglevo munkalap a jegy ala.
 *
 * CSAK AZ AZONOSITO: a csatolas nem valtoztat semmit a lapon azon kivul, hogy
 * melyik jegy alatt all. Barmi mas mezo itt azt sugallna, hogy a csatolas
 * kozben a lapot is szerkesztjuk.
 */
export class AttachWorksheetDto {
  @IsString() @MaxLength(64) worksheetId!: string;
}
