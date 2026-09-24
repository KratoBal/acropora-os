import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/** Ugyanaz az alak, mint a hibajegyes `SendHandoverMailDto`. */
export class SendMaintenancePackageMailDto {
  @IsString() @IsOptional() @MaxLength(200) subject?: string;

  @IsString() @MinLength(1) @MaxLength(4000) message!: string;
}
