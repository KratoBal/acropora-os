import { Module } from "@nestjs/common";

import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AiUserContextController } from "./ai-user-context.controller.js";
import { AiUserContextGuard } from "./ai-user-context.guard.js";
import { AiUserContextRepository } from "./ai-user-context.repository.js";
import { AiUserContextService } from "./ai-user-context.service.js";

/**
 * `ServiceTokenRepository` is provided here rather than imported from
 * `TasksModule`: it is a stateless wrapper over Prisma, and providing it
 * keeps the two mechanisms from sharing anything but the hashing helper.
 */
@Module({
  controllers: [AiUserContextController],
  providers: [
    AiUserContextGuard,
    AiUserContextRepository,
    AiUserContextService,
    ServiceTokenRepository,
  ],
})
export class AiUserContextModule {}
