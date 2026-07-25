import { IsEmail, IsString, MinLength } from "class-validator";
import type { AuthenticatedUser } from "@acropora/types";

export interface AuthenticatedRequest {
  method?: string;
  headers: {
    authorization?: string;
    cookie?: string;
    "x-csrf-token"?: string | string[];
  };
  user?: AuthenticatedUser;
  authToken?: string;
  /** Set by AuthGuard when the request was authenticated via the session
   * cookie rather than a Bearer header — used to decide whether the CSRF
   * double-submit check applies. */
  authViaCookie?: boolean;
}

export interface DevelopmentLoginDto {
  email: string;
}

/**
 * Real, class-validator-checked DTO (unlike DevelopmentLoginDto above,
 * which is a plain interface deliberately left unvalidated by Nest's
 * global ValidationPipe, since interfaces erase at runtime). Production
 * login handles real credentials reaching a real password check, so it
 * gets a real class with decorators: `whitelist`/`forbidNonWhitelisted`
 * in main.ts only take effect for a recognized class metatype.
 */
export class ProductionLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
