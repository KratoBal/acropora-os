import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** ONLY THE IDENTIFIER: a link changes nothing about the worksheet or the sheet, any other field would suggest it does. */
export class LinkWorksheetDto {
  @IsString() @MaxLength(64) worksheetId!: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The picker's narrowing. The date format is checked again (as a real calendar day) by `worksheetCreatedRange`. */
export class LinkableWorksheetsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Matches(DAY) createdFrom?: string;
  @IsOptional() @Matches(DAY) createdTo?: string;
}
