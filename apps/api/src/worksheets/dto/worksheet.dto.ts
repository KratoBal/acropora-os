import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export const WORKSHEET_VERSION_STATUSES = [
  "DRAFT",
  "AWAITING_SIGNATURE",
  "SIGNED",
  "REJECTED",
] as const;

export const WORKSHEET_SIGNATURE_DECISIONS = ["ACCEPTED", "REJECTED"] as const;

export class WorksheetListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() departmentId?: string;
  // Állapot szerinti szűrés szándékosan nincs: az állapot a LEGUTOLSÓ
  // verzióé, a `some: { status }` alakú Prisma-szűrő viszont bármelyik
  // korábbi verzióra is illeszkedne, és csendben mást jelentene, mint amit
  // a felületen ígér. Amíg nincs rá helyes (nyers) lekérdezés, nincs szűrő.
}

export class WorksheetLineDto {
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @MaxLength(500) @IsOptional() detail?: string | null;
  @IsString() @IsOptional() assetId?: string | null;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) quantity!: number;
  @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) unitNet!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) vatRatePercent!: number;
}

export class WorksheetContentDto {
  @IsString() @MinLength(1) @MaxLength(500) subject!: string;
  @IsString() @MaxLength(200) @IsOptional() unitText?: string | null;
  @IsString() @MaxLength(4000) @IsOptional() description?: string | null;
  @IsISO8601() @IsOptional() issueDate?: string | null;
  @IsISO8601() @IsOptional() fulfillmentDate?: string | null;
  @IsISO8601() @IsOptional() dueDate?: string | null;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WorksheetLineDto)
  lines: WorksheetLineDto[] = [];
}

export class CreateWorksheetDto extends WorksheetContentDto {
  @IsString() @MinLength(1) customerId!: string;
  @IsString() @MinLength(1) departmentId!: string;
}

export class UpdateWorksheetDraftDto extends WorksheetContentDto {}

export class AmendWorksheetDto extends WorksheetContentDto {
  /** Az indoklás kötelező: enélkül a napló nem mond semmit arról, miért módosult egy kiadott dokumentum. */
  @IsString() @MinLength(3) @MaxLength(1000) changeReason!: string;
}

export class SignWorksheetVersionDto {
  @IsIn(WORKSHEET_SIGNATURE_DECISIONS)
  decision!: (typeof WORKSHEET_SIGNATURE_DECISIONS)[number];
  @IsString() @MinLength(2) @MaxLength(200) signerName!: string;
  @IsString() @MaxLength(1000) @IsOptional() note?: string | null;
}

export class CreateWorksheetDepartmentDto {
  @Matches(/^[A-Za-z]{1,3}$/, {
    message: "A részleg kódja legfeljebb három betű lehet (pl. BIO).",
  })
  code!: string;
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
}

export class SetWorksheetPartnerCodeDto {
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,7}$/, {
    message:
      "A partner rövidítése betűvel kezdődő, 2-8 karakteres kód lehet (pl. FANK).",
  })
  partnerCode!: string;
}
