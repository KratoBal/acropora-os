import { IsString, MinLength } from "class-validator";

/** Egy nem párosodott, tárolt fájl hozzárendelése a bejövő számlához. */
export class IncomingAssignDocumentDto {
  @IsString()
  @MinLength(1)
  documentId!: string;
}
