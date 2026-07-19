import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasAllPermissions, type Permission } from "@acropora/types";

import type { AuthenticatedRequest } from "../auth.types.js";
import { REQUIRED_PERMISSIONS_KEY } from "../decorators/require-permissions.decorator.js";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permissions?.length) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;

    if (!user || !hasAllPermissions(user, permissions)) {
      throw new ForbiddenException("Nincs jogosultságod ehhez a művelethez.");
    }

    return true;
  }
}
