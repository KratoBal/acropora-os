import { IsString, MinLength } from "class-validator";

export class ChangeOwnPasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangeOwnSigningCodeDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  signingCode!: string;
}
