import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import type { AuthenticatedRequest } from "../auth.types.js";
import { assistantEndpointDenied } from "../assistant-readonly.policy.js";

@Injectable()
export class AssistantReadonlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.sessionKind !== "ASSISTANT_READONLY") return true;
    const controllers: string | string[] =
      Reflect.getMetadata(PATH_METADATA, context.getClass()) ?? "";
    const handlers: string | string[] =
      Reflect.getMetadata(PATH_METADATA, context.getHandler()) ?? "";
    const denied = [controllers].flat().some((controller) =>
      [handlers].flat().some((handler) =>
        assistantEndpointDenied(
          [controller, handler]
            .map((p) => p.replace(/^\/+|\/+$/g, ""))
            .filter(Boolean)
            .join("/"),
        ),
      ),
    );
    if (request.method !== "GET" || denied) {
      throw new ForbiddenException(
        "Az assistant-belépő kizárólag mellékhatás nélküli GET kérésekhez használható.",
      );
    }
    return true;
  }
}
