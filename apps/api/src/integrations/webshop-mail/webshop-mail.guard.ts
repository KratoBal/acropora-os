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
  WEBSHOP_MAIL_ENVIRONMENT,
  webshopMailTokenId,
} from "./webshop-mail.config.js";

interface WebshopMailRequest {
  headers: { authorization?: string };
}

/**
 * Authenticates the webshop for RENDERING ITS MAILS, and nothing else.
 *
 * The same three checks as `AiProductSearchGuard`, on its own record: the
 * token exists, is not revoked, and is THE record named in this endpoint's
 * configuration. Any other live token fails exactly like an unknown one.
 */
@Injectable()
export class WebshopMailGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    @Optional()
    @Inject(WEBSHOP_MAIL_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedTokenId = webshopMailTokenId(this.environment);
    if (!allowedTokenId)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const request = context.switchToHttp().getRequest<WebshopMailRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);
    if (!token || token.id !== allowedTokenId)
      throw new UnauthorizedException("Érvénytelen token.");
    return true;
  }
}
