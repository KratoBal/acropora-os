import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * EGY ÁTIRÁNYÍTÁS-KÖTEG VISSZAVONÁSÁNAK KÉRÉSE. A `batchId` a betöltő írásának válaszában jött vissza. Alapból SZÁRAZFUTÁS;
 * íráshoz az utolsó szárazfutás `planHash`-e kell (ugyanaz a rend, mint a betöltőknél).
 */
export class RedirectUndoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  batchId!: string;

  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  planHash?: string;
}
