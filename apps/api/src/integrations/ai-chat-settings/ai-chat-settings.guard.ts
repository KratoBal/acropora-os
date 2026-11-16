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
  AI_CHAT_SETTINGS_ENVIRONMENT,
  aiChatSettingsTokenId,
} from "./ai-chat-settings.config.js";

interface SettingsRequest {
  headers: { authorization?: string };
}

/**
 * Authenticates the AI service for READING the chat settings, and nothing else.
 *
 * The same three checks as `WebshopMailGuard`, on its own record: the token exists, is not revoked, and is THE record named in this
 * endpoint's configuration. Any other live token fails exactly like an unknown one.
 */
@Injectable()
export class AiChatSettingsGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    @Optional()
    @Inject(AI_CHAT_SETTINGS_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedTokenId = aiChatSettingsTokenId(this.environment);
    if (!allowedTokenId)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const request = context.switchToHttp().getRequest<SettingsRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);
    if (!token || token.id !== allowedTokenId)
      throw new UnauthorizedException("Érvénytelen token.");
    return true;
  }
}
