import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { POS_INTERNAL_USE_NOTE_MAX } from "@acropora/types";

/** Csak termék: a belső felhasználásnak nincs kézi tétele (kártya ec51e614). */
export class CreatePosInternalUseLineDto {
  @IsString()
  @MinLength(1)
  variantId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class CreatePosInternalUseDto {
  // a csupa szóköz megjegyzést a service utasítja el (trim után), mert a DTO a nyers szöveget látja
  @IsString()
  @MaxLength(POS_INTERNAL_USE_NOTE_MAX)
  note!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePosInternalUseLineDto)
  lines!: CreatePosInternalUseLineDto[];
}
