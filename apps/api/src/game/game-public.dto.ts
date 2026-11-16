import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * The public entry, as the page sends it (exchange/jatek/jatek-api-szerzodes.md). Only the shape is checked here; the
 * service says what is wrong in the contract's codes (INVALID_EMAIL, INVALID_ANSWER, ...).
 */
export class GameEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  questionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  /** the player's name (required for a new entry; the service says INVALID_NAME) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  answer?: string;

  /** the two separate, unticked checkboxes: the rules accepted, the data consent given (both required for an entry) */
  @IsOptional()
  @IsBoolean()
  rulesAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;

  /** the versions of the two texts the page showed (see `game-consent.ts`) */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  rulesVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  privacyVersion?: string;

  /** the bot trap: a hidden field a person leaves empty */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  website?: string;
}

export class GameConfirmDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  token?: string;
}
