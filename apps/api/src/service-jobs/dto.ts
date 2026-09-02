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
