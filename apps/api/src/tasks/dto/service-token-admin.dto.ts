import { Transform } from "class-transformer";
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
  MinLength,
} from "class-validator";

/** The same pattern the command line enforces (`service-token.cli.ts`): one rule for the slug, wherever the token is made. */
export const SERVICE_TOKEN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const SERVICE_TOKEN_DEFAULT_DAILY_LIMIT = 200;

/**
 * THE SERVICE TOKEN'S CREATION (card c5a8e6d6; `POST /service-tokens`).
 *
 * The account is MANDATORY (`userEmail`): a token with no account behind it authenticates nobody, and the content entry
 * refuses it. Which accounts it may be bound to is the service's rule (`service-token-admin.rules.ts`); this class checks
 * the shape only. The global ValidationPipe (whitelist + forbidNonWhitelisted) rejects any other key.
 */
export class CreateServiceTokenDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @Matches(SERVICE_TOKEN_SLUG_PATTERN, {
    message:
      "A slug kisbetűvel vagy számmal kezdődik, és 2-40 karakter: kisbetű, szám, kötőjel.",
  })
  slug!: string;

  @Transform(trimmed)
  @IsEmail()
  @MaxLength(254)
  userEmail!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyLimit?: number;
}

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
