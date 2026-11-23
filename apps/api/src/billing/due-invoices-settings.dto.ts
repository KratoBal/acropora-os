import { Transform } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
} from "class-validator";
import type { DueInvoicesMailSettingsInput } from "@acropora/types";

/**
 * A LEJÁRÓ SZÁMLÁK LEVELÉNEK BEÁLLÍTÁSA (`PUT billing/due-invoices/settings`). Az alak itt csak típus-szintű; a TARTALMI ellenőrzés (cím-alak, idő,
 * sorrend, darabszám) a `checkDueInvoicesSettings` függvényé, ami a mentés előtti egyetlen kapu, és a hibákat mondatban adja vissza.
 */
export class DueInvoicesMailSettingsDto implements DueInvoicesMailSettingsInput {
  @IsBoolean() enabled!: boolean;

  @IsArray()
  @IsString({ each: true })
  recipients!: string[];

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Transform(({ value }: { value: unknown }) => (value === "" ? null : value))
  fromAddress!: string | null;

  @IsInt() weekday!: number;
  @IsString() earliest!: string;
  @IsString() latest!: string;
}
