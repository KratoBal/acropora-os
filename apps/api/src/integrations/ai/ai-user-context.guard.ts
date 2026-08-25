import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import type { ServiceToken } from "@acropora/database";

import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import {
  AI_USER_CONTEXT_ENVIRONMENT,
  aiUserContextTokenId,
} from "./ai-user-context.config.js";

// Structurally typed rather than extending express's `Request`, matching
// ServiceTokenRequest and AuthenticatedRequest elsewhere in this API.
export interface AiUserContextRequest {
  headers: {
    authorization?: string;
    "x-acropora-user-id"?: string;
  };
  aiServiceToken?: ServiceToken;
}

/**
 * Authenticates the AI agent, and nothing else.
 *
 * This is deliberately NOT `ServiceTokenGuard`. That guard carries an
 * explicit instruction in its own documentation: it is used on exactly one
 * controller, and adding it to a second one "would silently widen what every
 * existing token can do, so do not - mint a separate mechanism instead".
 * This is that separate mechanism, and the widening is prevented twice over:
 * the guard is its own class, and it accepts exactly one token record.
 *
 * What it reuses is the LOOKUP, not the authority: the raw value is resolved
 * through `ServiceTokenRepository`, so the SHA-256 hashing lives in one place
 * for both mechanisms. A second hashing site would be a second place to get
 * it wrong.
 *
 * Three checks, and the third is what makes the fleet's existing tokens
 * powerless here: the token must exist, must not be revoked, and must be THE
 * record named in the configuration.
 *
 * A fourth check that the brief asks for cannot be written: the model has no
 * expiry column (id, name, slug, tokenHash, dailyLimit, lastUsedAt,
 * revokedAt, createdAt). Its absence is a missing concept, not a forgotten
 * line.
 */
@Injectable()
export class AiUserContextGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    @Optional()
    @Inject(AI_USER_CONTEXT_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedTokenId = aiUserContextTokenId(this.environment);

    /**
     * An unconfigured allowlist rejects everything.
     *
     * This is the single most dangerous line in the file if written the
     * other way round: an empty allowlist that means "no restriction" turns
     * a forgotten environment variable into an open door, and nothing in the
     * response would show it. The test suite asserts this branch directly.
     */
    if (!allowedTokenId)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const request = context.switchToHttp().getRequest<AiUserContextRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);

    /**
     * A live token that is not the dedicated record fails exactly like an
     * unknown one. The caller learns whether it may use THIS endpoint, and
     * nothing about whether the value is a valid credential elsewhere.
     */
    if (!token || token.id !== allowedTokenId)
      throw new UnauthorizedException("Érvénytelen token.");

    request.aiServiceToken = token;
    return true;
  }
}
