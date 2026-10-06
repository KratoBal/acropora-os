import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AssistantController } from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import { AssistantBudgetRepository } from "./assistant-budget.repository.js";
@Module({
  imports: [AuthModule],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantBudgetRepository],
  exports: [AssistantService],
})
export class AssistantModule {}
