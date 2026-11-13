import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { DOCUMENT_CAPTION_MAX_LENGTH } from "../../documents/document-caption.js";
import {
  OPERATIONS_ENTRY_LIMITS,
  OPERATIONS_TEMPLATE_LIMITS,
  type OperationsEntryValue,
} from "@acropora/types";

/**
 * A BEMENET FORMAI ELLENŐRZÉSE ITT ÁLL; az ÉRTÉKEK és az idők szabályai a közös `operationsEntryErrors`-ban (a telefon is ezt
 * futtatja), a szolgáltatás hívja. Az `values` itt csak „objektum”: a kulcsok és a típusok a sablon mezőin múlnak.
 */
const L = OPERATIONS_ENTRY_LIMITS;

export class CreateOperationsLogEntryDto {
  @IsString()
  @Matches(L.clientOperationIdPattern, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, pont, kötőjel, aláhúzás vagy kettőspont.",
  })
  clientOperationId!: string;

  @IsString() templateId!: string;
  @IsString() assetId!: string;

  @IsArray()
  @ArrayMaxSize(OPERATIONS_TEMPLATE_LIMITS.fieldsMax + 20)
  @IsString({ each: true })
  @MaxLength(OPERATIONS_TEMPLATE_LIMITS.keyMax, { each: true })
  templateFieldKeys!: string[];

  @IsISO8601() startedAt!: string;
  @IsISO8601() finishedAt!: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(L.participantsMax + 5)
  @IsString({ each: true })
  participantIds?: string[];

  @IsObject() values!: Record<string, OperationsEntryValue>;

  @IsBoolean() @IsOptional() anomaly?: boolean;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  anomalyNote?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  internalNote?: string | null;
}

export class OperationsLogEntryListQueryDto {
  @IsString() @IsOptional() assetId?: string;
  @IsString() @IsOptional() templateId?: string;
  @IsISO8601() @IsOptional() from?: string;
  @IsISO8601() @IsOptional() to?: string;
  @Type(() => Boolean) @IsBoolean() @IsOptional() anomalyOnly?: boolean;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}

/** `POST /operations-log/entries/:id/photos`: egy kép egy fénykép mezőhöz; az újraküldés kulcsával. */
export class UploadOperationsLogPhotoDto {
  @IsString()
  @MaxLength(OPERATIONS_TEMPLATE_LIMITS.keyMax)
  fieldKey!: string;

  @IsString()
  @Matches(L.clientOperationIdPattern, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, pont, kötőjel, aláhúzás vagy kettőspont.",
  })
  @IsOptional()
  clientOperationId?: string;

  @IsString()
  @MaxLength(DOCUMENT_CAPTION_MAX_LENGTH)
  @IsOptional()
  caption?: string;
}

/** `GET /operations-log/report` és `/report/pdf`: a hónap és a hatókör (helyszín VAGY eszköz; a szolgáltatás ellenőrzi). */
export class OperationsReportQueryDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: "A hónap alakja ÉÉÉÉ-HH legyen.",
  })
  month!: string;

  @IsString() @IsOptional() departmentId?: string;
  @IsString() @IsOptional() assetId?: string;
}
