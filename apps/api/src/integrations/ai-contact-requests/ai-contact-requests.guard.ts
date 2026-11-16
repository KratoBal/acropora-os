import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";

import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import {
  AI_CONTACT_ENVIRONMENT,
  aiContactTokenId,
} from "./ai-contact-requests.config.js";

interface ContactRequest {
  headers: { authorization?: string };
}

/**
 * Authenticates the AI service for WRITING a contact request, and nothing else.
 *
 * The same three checks as `AiChatSettingsGuard`, on its own record: the token exists, is not revoked, and is THE record named in
 * this endpoint's configuration. Any other live token fails exactly like an unknown one.
 */
@Injectable()
export class AiContactRequestsGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    @Optional()
    @Inject(AI_CONTACT_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedTokenId = aiContactTokenId(this.environment);
    if (!allowedTokenId)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const request = context.switchToHttp().getRequest<ContactRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);
    if (!token || token.id !== allowedTokenId)
      throw new UnauthorizedException("Érvénytelen token.");
    return true;
  }
}
