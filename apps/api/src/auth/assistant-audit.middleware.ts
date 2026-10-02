import {
  ForbiddenException,
  Injectable,
  Logger,
  type NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import {
  AssistantAuditRepository,
  type AssistantAuditRequest,
} from "./assistant-audit.repository.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { parseCookies, SESSION_COOKIE_NAME } from "./cookie.util.js";
import { SessionRepository } from "./session.repository.js";

export interface AssistantHttpRequest extends AuthenticatedRequest {
  originalUrl: string;
}
export interface AssistantHttpResponse {
  statusCode: number;
  once(event: "finish" | "close", listener: () => void): void;
}

/** Runs before routing/guards: denied, expired, public and 404 requests count too. */
@Injectable()
export class AssistantAuditMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AssistantAuditMiddleware.name);
  constructor(
    private readonly sessions: SessionRepository,
    private readonly audit: AssistantAuditRepository,
  ) {}

  async use(
    request: AssistantHttpRequest,
    response: AssistantHttpResponse,
    next: () => void,
  ): Promise<void> {
    const [scheme, bearer] = request.headers.authorization?.split(" ") ?? [];
    const token =
      scheme === "Bearer" && bearer
        ? bearer
        : parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token) {
      next();
      return;
    }
    const session = await this.sessions.findAssistant(token);
    if (!session) {
      next();
      return;
    }
    request.sessionKind = session.kind;
    const entry: AssistantAuditRequest = {
      actorUserId: session.userId,
      sessionId: session.id,
      // Do not persist query strings, credentials, request/response bodies or tokens.
      endpoint: request.originalUrl.split("?")[0] ?? "",
      method: request.method ?? "",
      timestamp: new Date().toISOString(),
    };
    // Fail closed if the durable start record cannot be stored.
    let id: string;
    try {
      id = await this.audit.begin(entry);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "assistant.audit_start_failed",
          ...entry,
          status: 500,
          result: "AUDIT_UNAVAILABLE",
        }),
      );
      throw error;
    }
    let completed = false;
    const finish = (aborted: boolean) => {
      if (completed) return;
      completed = true;
      const status = aborted ? 499 : response.statusCode;
      const result = aborted
        ? "ABORTED"
        : status < 400
          ? "SUCCESS"
          : "REJECTED";
      void this.audit.complete(id, entry, status, result).catch(() => {
        // The durable PENDING row remains; structured fallback records the result.
        this.logger.error(
          JSON.stringify({
            event: "assistant.audit_completion_failed",
            auditId: id,
            ...entry,
            status,
            result,
          }),
        );
      });
    };
    response.once("finish", () => finish(false));
    response.once("close", () => finish(true));
    if (session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException("Lejárt assistant-belépő.");
    // Also cover unmatched routes and cookie CSRF failures before AuthGuard.
    if (request.method !== "GET")
      throw new ForbiddenException(
        "Az assistant-belépő csak GET kérést engedélyez.",
      );
    next();
  }
}
