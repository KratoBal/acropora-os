import { Module } from "@nestjs/common";

import { AssistantAuditMiddleware } from "./assistant-audit.middleware.js";
import { AssistantAuditRepository } from "./assistant-audit.repository.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
import { SessionRepository } from "./session.repository.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthUserResolver,
    SessionRepository,
    AssistantAuditRepository,
    AssistantAuditMiddleware,
  ],
  exports: [AuthService, SessionRepository, AssistantAuditRepository, AssistantAuditMiddleware],
})
export class AuthModule {}
