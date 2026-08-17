import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { ServiceToken } from "@acropora/database";

import { ServiceTokenRepository } from "./service-token.repository.js";

// Structurally typed rather than extending express's `Request`, matching
// AuthenticatedRequest in ../auth/auth.types.ts - the API does not depend
// on @types/express anywhere else and should not start here.
export interface ServiceTokenRequest {
  headers: {
    authorization?: string;
  };
  serviceToken?: ServiceToken;
}

/**
 * Authenticates a machine caller against the `ServiceToken` table.
 *
 * This guard is used in exactly one place - `TaskIngestController`, which
 * exposes exactly one route, `POST /tasks/ingest`. That is the whole
 * security model: a service token cannot read an order, edit a product or
 * list a customer, not because a permission forbids it, but because no
 * other endpoint in the application would accept the credential at all.
 * Adding this guard to a second controller would silently widen what every
 * existing token can do, so do not - mint a separate mechanism instead.
 *
 * A session cookie is deliberately ignored here. The route carries no
 * ambient credential, which is also why it needs no CSRF check.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly tokens: ServiceTokenRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ServiceTokenRequest>();
    const [scheme, rawToken] = request.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !rawToken)
      throw new UnauthorizedException("Szolgáltatás-token szükséges.");

    const token = await this.tokens.findActive(rawToken);
    if (!token) throw new UnauthorizedException("Érvénytelen token.");

    request.serviceToken = token;
    return true;
  }
}
