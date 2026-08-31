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
  AI_PRODUCT_SEARCH_ENVIRONMENT,
  aiProductSearchTokenId,
} from "./ai-product-search.config.js";

export interface AiProductSearchRequest {
  headers: {
    authorization?: string;
  };
  aiServiceToken?: ServiceToken;
}

/**
 * Authenticates the AI agent for CATALOGUE SEARCH, and nothing else.
 *
 * A separate class from `AiUserContextGuard` on purpose, not by accident: its
 * documentation instructs that a second use case must mint its own mechanism
 * rather than widen the existing one. What is reused is the LOOKUP, not the
 * authority - the raw value is resolved through `ServiceTokenRepository`, so
 * the SHA-256 hashing lives in one place for every mechanism. A second
 * hashing site would be a second place to get it wrong.
 *
 * Three checks, and the third is what makes every other token in the fleet
 * powerless here: the token must exist, must not be revoked, and must be THE
 * record named in this endpoint's own configuration.
 */
@Injectable()
export class AiProductSearchGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    @Optional()
    @Inject(AI_PRODUCT_SEARCH_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedTokenId = aiProductSearchTokenId(this.environment);

    /**
     * An unconfigured allowlist rejects everything.
     *
     * Written the other way round this would be the most dangerous line in
     * the file: an empty allowlist meaning "no restriction" turns a forgotten
     * environment variable into an open door onto the whole catalogue, and
     * nothing in the response would show it.
     */
    if (!allowedTokenId)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const request = context.switchToHttp().getRequest<AiProductSearchRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);

    /**
     * A live token that is not the dedicated record fails exactly like an
     * unknown one - including the user-context token. The caller learns
     * whether it may use THIS endpoint, and nothing about whether the value
     * is a valid credential elsewhere.
     */
    if (!token || token.id !== allowedTokenId)
      throw new UnauthorizedException("Érvénytelen token.");

    request.aiServiceToken = token;
    return true;
  }
}
