import {
  IsBoolean,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * The ReefClub request bodies. Real classes, because the global
 * `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) acts only on a class
 * metatype: an unknown field is refused, never ignored (plan 3.1).
 *
 * The password ceiling is there for scrypt, not for the user: an unbounded
 * body would let one request buy unbounded hashing work.
 */
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;
const EMAIL_MAX = 254;
const TOKEN_MAX = 200;

export class ReefClubRegisterDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;

  /** The version of the privacy notice the user accepted (plan 1.1). */
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/)
  consentVersion!: string;
}

export class ReefClubLoginDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ReefClubTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX)
  token!: string;
}

export class ReefClubPasswordResetRequestDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX)
  email!: string;
}

export class ReefClubPasswordResetConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ReefClubUpdateMeDto {
  @IsBoolean()
  notifyOnRelease!: boolean;
}
