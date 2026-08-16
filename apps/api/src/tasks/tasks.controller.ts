import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateTaskDto, TaskListQueryDto } from "./dto/task.dto.js";
import { TasksService } from "./tasks.service.js";

/**
 * Every route is scoped to the authenticated user inside the service - the
 * `tasks.view` permission decides who has a task board at all, and the
 * `assigneeId`/`createdById` check decides which rows they see. No
 * endpoint here can list another person's board.
 */
@Controller("tasks")
@RequirePermissions(PERMISSIONS.TASKS_VIEW)
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get("mine")
  listMine(
    @Query() query: TaskListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listMine(user.id, query);
  }

  @Get("assignees")
  assignees() {
    return this.service.assigneeOptions();
  }

  @Post()
  create(@Body() input: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(input, user.id);
  }

  @Patch(":id/close")
  close(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.close(id, user.id);
  }

  @Patch(":id/reopen")
  reopen(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.reopen(id, user.id);
  }
}
