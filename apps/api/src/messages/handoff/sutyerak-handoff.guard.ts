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
  SUTYERAK_HANDOFF_ENVIRONMENT,
  sutyerakHandoffTokenId,
} from "./sutyerak-handoff.config.js";

interface HandoffRequest {
  headers: { authorization?: string };
}

/**
 * ACROBOT VISSZAÍRÁSA, és semmi más: a token létezik, nincs visszavonva, és
 * PONTOSAN a beállításban megnevezett rekord. Bármely más élő token úgy bukik,
 * mint egy ismeretlen (a `WebshopMailGuard` mintája).
 */
@Injectable()
export class SutyerakHandoffGuard implements CanActivate {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(
    private readonly tokens: ServiceTokenRepository,
    @Optional()
    @Inject(SUTYERAK_HANDOFF_ENVIRONMENT)
    environment?: NodeJS.ProcessEnv,
  ) {
    this.environment = environment ?? process.env;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedTokenId = sutyerakHandoffTokenId(this.environment);
    if (!allowedTokenId)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");
    const request = context.switchToHttp().getRequest<HandoffRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");
    const token = await this.tokens.findActive(rawToken);
    if (!token || token.id !== allowedTokenId)
      throw new UnauthorizedException("Érvénytelen token.");
    return true;
  }
}
