import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
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
/** An ID token is a few kilobytes; `ID_TOKEN_MAX_LENGTH` in reefclub-id-token.ts. */
const ID_TOKEN_MAX = 8192;
const NONCE_MIN = 16;
const NONCE_MAX = 128;
const CONSENT_VERSION = /^[A-Za-z0-9._-]{1,40}$/;

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
  @Matches(CONSENT_VERSION)
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

/**
 * Google sign-in (slice 3). The consent is needed only when the sign-in
 * creates the account; for a bound account it is ignored.
 */
export class ReefClubGoogleSignInDto {
  @IsString()
  @MinLength(1)
  @MaxLength(ID_TOKEN_MAX)
  idToken!: string;

  @IsOptional()
  @IsString()
  @Matches(CONSENT_VERSION)
  consentVersion?: string;
}

/** Apple sign-in: the raw nonce, whose SHA-256 the token must carry. */
export class ReefClubAppleSignInDto extends ReefClubGoogleSignInDto {
  @IsString()
  @MinLength(NONCE_MIN)
  @MaxLength(NONCE_MAX)
  nonce!: string;
}

/** Adding Google to the signed-in account. */
export class ReefClubGoogleLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(ID_TOKEN_MAX)
  idToken!: string;
}

/** Adding Apple to the signed-in account. */
export class ReefClubAppleLinkDto extends ReefClubGoogleLinkDto {
  @IsString()
  @MinLength(NONCE_MIN)
  @MaxLength(NONCE_MAX)
  nonce!: string;
}

/**
 * Deleting the account (slice 6): a fresh sign-in with one of the account's
 * own methods. The password, or a Google or Apple ID token (Apple with its
 * raw nonce); the token must be at most ten minutes old.
 */
export class ReefClubDeleteMeDto {
  @IsIn(["PASSWORD", "GOOGLE", "APPLE"])
  method!: "PASSWORD" | "GOOGLE" | "APPLE";

  @ValidateIf((body: ReefClubDeleteMeDto) => body.method === "PASSWORD")
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password?: string;

  @ValidateIf((body: ReefClubDeleteMeDto) => body.method !== "PASSWORD")
  @IsString()
  @MinLength(1)
  @MaxLength(ID_TOKEN_MAX)
  idToken?: string;

  @ValidateIf((body: ReefClubDeleteMeDto) => body.method === "APPLE")
  @IsString()
  @MinLength(NONCE_MIN)
  @MaxLength(NONCE_MAX)
  nonce?: string;
}
