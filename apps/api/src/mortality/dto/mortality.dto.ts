import {
  MORTALITY_LIST_PAGE_SIZE,
  MORTALITY_SOURCE_NOTE_MAX,
  MORTALITY_SOURCE_TYPES,
  type CreateMortalityInput,
  type MortalityListQuery,
  type MortalitySourceType,
  type UpdateMortalityInput,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { DOCUMENT_CAPTION_MAX_LENGTH } from "../../documents/document-caption.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /mortality` (kártya 115c9740). */
export class MortalityListQueryDto implements MortalityListQuery {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MORTALITY_LIST_PAGE_SIZE.max)
  @IsOptional()
  pageSize?: number;
  @IsString() @MaxLength(200) @IsOptional() q?: string;
  @IsIn(MORTALITY_SOURCE_TYPES) @IsOptional() sourceType?: MortalitySourceType;
  @IsString() @IsOptional() supplierId?: string;
  @IsString() @IsOptional() aquariumId?: string;
  @IsString() @IsOptional() recordedById?: string;
  @Matches(DAY) @IsOptional() from?: string;
  @Matches(DAY) @IsOptional() to?: string;
}

/** `POST /mortality`. A rögzítő és a rögzítés ideje NEM bemenet: automatikus. */
export class CreateMortalityDto implements CreateMortalityInput {
  @IsString() @MinLength(1) productId!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @IsString() @MinLength(1) aquariumId!: string;
  @IsIn(MORTALITY_SOURCE_TYPES) sourceType!: MortalitySourceType;
  @IsString() @IsOptional() supplierId?: string | null;
  @IsString()
  @MaxLength(MORTALITY_SOURCE_NOTE_MAX)
  @IsOptional()
  sourceNote?: string | null;
  @IsString() @MaxLength(4000) @IsOptional() note?: string | null;
}

/** `PATCH /mortality/:id`: minden mező módosítható (acrobot 27141), auditnaplóval. */
export class UpdateMortalityDto implements UpdateMortalityInput {
  @IsString() @MinLength(1) @IsOptional() productId?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() quantity?: number;
  @IsString() @MinLength(1) @IsOptional() aquariumId?: string;
  @IsIn(MORTALITY_SOURCE_TYPES) @IsOptional() sourceType?: MortalitySourceType;
  @IsString() @IsOptional() supplierId?: string | null;
  @IsString()
  @MaxLength(MORTALITY_SOURCE_NOTE_MAX)
  @IsOptional()
  sourceNote?: string | null;
  @IsString() @MaxLength(4000) @IsOptional() note?: string | null;
}

/** A választók keresője. */
export class MortalityOptionQueryDto {
  @IsString() @MaxLength(200) @IsOptional() q?: string;
}

/** `POST /mortality/:id/photos`: egy felirat a kérés összes képére. */
export class UploadMortalityPhotoDto {
  @IsString()
  @MaxLength(DOCUMENT_CAPTION_MAX_LENGTH)
  @IsOptional()
  caption?: string;
}
